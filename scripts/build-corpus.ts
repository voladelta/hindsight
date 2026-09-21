import { createHash } from "node:crypto";
import { loadEnvironmentFiles } from "../src/server/env";
import { openStore } from "../src/server/db";
import { asString, parseCli, providerContext } from "../src/server/nansen/cli";
import { NansenError } from "../src/server/nansen/client";
import {
  auditCorpus,
  CORPUS_CONFIG,
  fetchUniverse,
  freezeCandidates,
  prepareOne,
  selectCandidates,
} from "../src/server/nansen/preparation";
import { replayNetworkSchema } from "../src/domain/replay-selection";

function deterministicRunId(
  asOf: string,
  seed: string,
  count: number,
  duration: string,
  network: string,
  skip: number,
) {
  return `corpus-${createHash("sha256")
    .update(
      `${CORPUS_CONFIG.version}:${asOf}:${seed}:${count}:${duration}:${network}:${skip}`,
    )
    .digest("hex")
    .slice(0, 20)}`;
}

async function main() {
  const options = parseCli(
    process.argv.slice(2),
    [
      "max-credits",
      "as-of",
      "count",
      "seed",
      "run-id",
      "duration",
      "chain",
      "skip",
    ],
    ["dry-run", "refresh"],
  );
  const asOf = asString(options["as-of"]) ?? "2026-08-01";
  const seed = asString(options.seed) ?? CORPUS_CONFIG.seed;
  const count = Number(asString(options.count) ?? CORPUS_CONFIG.sampleSize);
  const skip = Number(asString(options.skip) ?? 0);
  const durationOption = asString(options.duration) ?? "intraday";
  const network = replayNetworkSchema.safeParse(
    asString(options.chain) ?? "ethereum",
  );
  if (!network.success) throw new Error("--chain must be ethereum or solana.");
  if (durationOption !== "intraday" && durationOption !== "7d")
    throw new Error("--duration must be intraday or 7d.");
  const duration =
    durationOption === "intraday"
      ? ("INTRADAY" as const)
      : ("SEVEN_DAYS" as const);
  if (!Number.isInteger(count) || count < 1 || count > 100)
    throw new Error("--count must be an integer from 1 to 100.");
  if (!Number.isInteger(skip) || skip < 0 || skip + count > 100)
    throw new Error(
      "--skip must be a nonnegative integer with skip + count at most 100.",
    );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf))
    throw new Error("--as-of must be YYYY-MM-DD.");
  const runId =
    asString(options["run-id"]) ??
    deterministicRunId(asOf, seed, count, durationOption, network.data, skip);
  const estimate = 5 + count * 37;

  if (options["dry-run"] === true) {
    loadEnvironmentFiles();
    const store = openStore();
    try {
      console.log(`Corpus config: ${CORPUS_CONFIG.version}`);
      console.log(`Run ID: ${runId}`);
      console.log(
        `Chain: ${network.data}; as-of: ${asOf}; duration: ${durationOption}; seed: ${seed}; skip: ${skip}; requested candidates: ${count}`,
      );
      console.log(
        `Planning estimate: ${estimate} credits before retries (not a provider billing cap).`,
      );
      console.log(JSON.stringify(auditCorpus(store, runId), null, 2));
      console.log("Dry run made no provider requests.");
    } finally {
      store.sqlite.close();
    }
    return;
  }

  options["run-id"] = runId;
  const context = providerContext(options, estimate);
  try {
    const incompatible = context.store.sqlite
      .query(
        "SELECT COUNT(*) AS count FROM scenario_candidates WHERE run_id = ? AND config_version != ?",
      )
      .get(runId, CORPUS_CONFIG.version) as { count: number };
    if (incompatible.count > 0)
      throw new Error(
        "This run uses an older selection policy. Use a new run ID for the current corpus; existing rounds remain readable.",
      );

    const existing = context.store.sqlite
      .query(
        "SELECT COUNT(*) AS count FROM scenario_candidates WHERE run_id = ?",
      )
      .get(runId) as { count: number };
    if (existing.count === 0) {
      const universe = await fetchUniverse(context.client, asOf, network.data);
      const replacements = selectCandidates(
        universe,
        seed,
        skip + count,
        network.data,
      ).slice(skip);
      const frozen = freezeCandidates({
        store: context.store,
        runId,
        asOf,
        candidates: replacements,
        count,
        seed,
        network: network.data,
      });
      console.log(
        `Frozen ${frozen} input-only candidates before outcome retrieval.`,
      );
    }

    const candidates = context.store.sqlite
      .query(
        "SELECT id, token_address, token_name, token_symbol, status FROM scenario_candidates WHERE run_id = ? AND status != 'COMPLETE' ORDER BY ordinal",
      )
      .all(runId) as Array<{
      id: string;
      token_address: string;
      token_name: string;
      token_symbol: string;
      status: string;
    }>;
    for (const candidate of candidates) {
      try {
        await prepareOne({
          client: context.client,
          store: context.store,
          tokenAddress: candidate.token_address,
          asOf,
          name: candidate.token_name,
          symbol: candidate.token_symbol,
          candidateId: candidate.id,
          duration,
          network: network.data,
        });
      } catch (error) {
        const current = context.store.sqlite
          .query("SELECT status FROM scenario_candidates WHERE id = ?")
          .get(candidate.id) as { status: string };
        const status =
          current.status === "INPUT_READY"
            ? "MISSING_OUTCOME"
            : "INPUT_REJECTED";
        const code =
          error instanceof NansenError
            ? error.code
            : error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
              ? error.message
              : "PREPARATION_FAILED";
        context.store.sqlite
          .query(
            "UPDATE scenario_candidates SET status = ?, error_code = ? WHERE id = ?",
          )
          .run(status, code, candidate.id);
      }
    }
    console.log(JSON.stringify(auditCorpus(context.store, runId), null, 2));
    console.log(
      `Run ID: ${runId}. Reuse it to resume without replacing failed candidates.`,
    );
  } finally {
    context.store.sqlite.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Corpus build failed.",
  );
  process.exitCode = 1;
});
