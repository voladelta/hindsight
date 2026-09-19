import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  intradayAssumptions,
  scenarioSchema,
  sevenDayAssumptions,
  type RoundDuration,
  type Scenario,
} from "../../domain/model";
import {
  replayNetworkLabel,
  type ReplayNetwork,
} from "../../domain/replay-selection";
import {
  DAY,
  HOUR,
  evaluateRule,
  executionPrices,
  holderEvidence,
  measurement,
  timePolicy,
  visibleChart,
} from "../../domain/engine";
import { inputs, outcomes, type Store } from "../db";
import type { NansenClient } from "./client";
import {
  hasProviderWarnings,
  normalizeFlow,
  normalizeHolders,
  normalizePrices,
  normalizeUniverse,
  type UniverseCandidate,
} from "./contracts";

export const CORPUS_CONFIG = {
  version: "multichain-volume-uniform-v2",
  seed: "hindsight-2026-v1",
  fromDate: "2025-04-01",
  toDate: "2026-08-31",
  sampleSize: 25,
  volumeUsdMin: 250_000,
  liquidityUsdMin: 100_000,
  tokenAgeDaysMin: 30,
} as const;

const iso = (milliseconds: number) => new Date(milliseconds).toISOString();
const dayStart = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
const endOfDay = (milliseconds: number) => iso(milliseconds + DAY - 1);

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function selectCandidates(
  candidates: UniverseCandidate[],
  seed: string,
  count: number,
  network: ReplayNetwork = "ethereum",
) {
  const canonicalAddress = (address: string) =>
    network === "solana" ? address : address.toLowerCase();
  const unique = new Map(
    candidates.map((candidate) => [
      canonicalAddress(candidate.token_address),
      candidate,
    ]),
  );
  return [...unique.values()]
    .sort((left, right) =>
      digest(`${seed}:${canonicalAddress(left.token_address)}`).localeCompare(
        digest(`${seed}:${canonicalAddress(right.token_address)}`),
      ),
    )
    .slice(0, count);
}

export async function prepareOne(options: {
  client: NansenClient;
  store: Store;
  tokenAddress: string;
  asOf: string;
  name?: string;
  symbol?: string;
  candidateId?: string;
  duration?: RoundDuration;
  network?: ReplayNetwork;
}) {
  const { client, store, tokenAddress, asOf, candidateId } = options;
  const duration = options.duration ?? "INTRADAY";
  const network = options.network ?? "ethereum";
  const intraday = duration === "INTRADAY";
  const config = intraday ? intradayAssumptions : sevenDayAssumptions;
  const candleMilliseconds = intraday ? HOUR : DAY;
  const asOfStart = dayStart(asOf);
  if (!Number.isFinite(asOfStart) || iso(asOfStart).slice(0, 10) !== asOf)
    throw new Error("Invalid UTC as-of date.");
  const addressIsValid =
    network === "solana"
      ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(tokenAddress)
      : /^0x[a-fA-F0-9]{40}$/.test(tokenAddress);
  if (!addressIsValid)
    throw new Error(`Invalid ${replayNetworkLabel(network)} token address.`);

  const times = timePolicy(asOf, duration);
  const flowFrom = iso(asOfStart - 6 * DAY);
  const flowTo = endOfDay(asOfStart);
  const historyFrom = iso(asOfStart - 29 * DAY);
  const historyTo = endOfDay(asOfStart);
  const fingerprints: string[] = [];
  const fetched: string[] = [];

  const request = async (
    endpoint: Parameters<NansenClient["request"]>[0],
    body: unknown,
  ) => {
    const response = await client.request(endpoint, body);
    fingerprints.push(response.fingerprint);
    fetched.push(response.fetchedAt);
    return response.payload;
  };

  if (candidateId) updateCandidate(store, candidateId, "PREPARING_INPUT");
  const historyRaw = await request("prices", {
    chain: network,
    token_address: tokenAddress,
    timeframe: intraday ? "1h" : "1d",
    date: { from: historyFrom, to: historyTo },
  });
  const flowRaw = await request("flow", {
    chain: network,
    token_address: tokenAddress,
    date_range: { from: flowFrom, to: flowTo },
    apply_blacklist_filter: true,
  });
  const holdersRaw = await request("holders", {
    chain: network,
    token_address: tokenAddress,
    as_of_date: asOf,
    label_type: "all_holders",
    pagination: { page: 1, per_page: 10 },
    order_by: [{ field: "token_amount", direction: "DESC" }],
    apply_blacklist_filter: true,
  });
  const historyResult = normalizePrices(historyRaw, candleMilliseconds);
  visibleChart(historyResult.candles, times.cutoff, config);
  const holderResult = normalizeHolders(holdersRaw);
  const evidence = {
    flowUsd: measurement(normalizeFlow(flowRaw)),
    ...holderEvidence(holderResult.holders, holderResult.sortVerified),
  };
  const opponent = evaluateRule(evidence);
  if (candidateId) updateCandidate(store, candidateId, "INPUT_READY");

  // Selection and all input-derived state are frozen before outcome retrieval.
  const futureRaw = await request("prices", {
    chain: network,
    token_address: tokenAddress,
    timeframe: intraday ? "1h" : "1d",
    date: {
      from: times.entryAt,
      to: iso(Date.parse(times.exitAt) + candleMilliseconds - 1),
    },
  });
  const futureResult = normalizePrices(futureRaw, candleMilliseconds);
  const preparedAt = new Date().toISOString();
  const scenarioWithoutVersion = {
    identity: {
      name:
        options.name ??
        historyResult.identity.name ??
        `${replayNetworkLabel(network)} token ${tokenAddress.slice(0, 8)}…`,
      symbol:
        options.symbol ??
        historyResult.identity.symbol ??
        `${tokenAddress.slice(0, 6)}…${tokenAddress.slice(-4)}`,
      chain: replayNetworkLabel(network),
    },
    ...times,
    history: historyResult.candles,
    future: futureResult.candles,
    evidence,
    opponent,
    assumptions: config,
    preparedAt,
    source: intraday ? ("nansen-v2" as const) : ("nansen-v1" as const),
    provenance: {
      fetchedAt: fetched.sort().at(-1) ?? preparedAt,
      providerVersion: "Nansen API historical endpoints / normalizer v1",
      requestFingerprints: fingerprints,
      coverageWarnings: [
        ...(hasProviderWarnings(historyRaw) ? ["HISTORY_WARNING_PRESENT"] : []),
        ...(hasProviderWarnings(flowRaw) ? ["FLOW_WARNING_PRESENT"] : []),
        ...(hasProviderWarnings(holdersRaw) ? ["HOLDERS_WARNING_PRESENT"] : []),
        ...(hasProviderWarnings(futureRaw) ? ["OUTCOME_WARNING_PRESENT"] : []),
      ],
    },
  };
  const version = `nansen-v1-${digest(
    JSON.stringify({ requestFingerprints: fingerprints, fetchedAt: fetched }),
  ).slice(0, 24)}`;
  const scenario = scenarioSchema.parse({ version, ...scenarioWithoutVersion });
  const existing = store.sqlite
    .query("SELECT version FROM scenario_inputs WHERE version = ?")
    .get(version);
  if (existing) {
    if (candidateId) updateCandidate(store, candidateId, "COMPLETE", version);
    return store.scenario(version);
  }
  persistScenario(store, scenario);
  if (candidateId) updateCandidate(store, candidateId, "COMPLETE", version);
  return scenario;
}

function persistScenario(store: Store, scenario: Scenario) {
  const { future, ...input } = scenario;
  const ordinal =
    store.db
      .select({ maximum: sql<number>`COALESCE(MAX(${inputs.ordinal}), -1)` })
      .from(inputs)
      .get()!.maximum + 1;
  store.sqlite
    .transaction(() => {
      store.db
        .insert(inputs)
        .values({
          version: scenario.version,
          payload: JSON.stringify(input),
          ordinal,
        })
        .onConflictDoNothing()
        .run();
      store.db
        .insert(outcomes)
        .values({ version: scenario.version, payload: JSON.stringify(future) })
        .onConflictDoNothing()
        .run();
    })
    .immediate();
}

function updateCandidate(
  store: Store,
  id: string,
  status: string,
  scenarioVersion: string | null = null,
) {
  store.sqlite
    .query(
      "UPDATE scenario_candidates SET status = ?, scenario_version = COALESCE(?, scenario_version), error_code = NULL WHERE id = ?",
    )
    .run(status, scenarioVersion, id);
}

export async function fetchUniverse(
  client: NansenClient,
  asOf: string,
  network: ReplayNetwork = "ethereum",
) {
  const response = await client.request("screener", {
    to_date: asOf,
    timeframe_days: 7,
    chains: [network],
    trader_type: "all",
    exclude_sectors: ["Stablecoin"],
    filters: {
      volume_usd: { min: CORPUS_CONFIG.volumeUsdMin },
      liquidity_usd: { min: CORPUS_CONFIG.liquidityUsdMin },
      token_age_days: { min: CORPUS_CONFIG.tokenAgeDaysMin },
    },
    pagination: { page: 1, per_page: 100 },
    order_by: [{ field: "volume", direction: "DESC" }],
    apply_blacklist_filter: true,
  });
  return normalizeUniverse(response.payload);
}

export function freezeCandidates(options: {
  store: Store;
  runId: string;
  asOf: string;
  candidates: UniverseCandidate[];
  count: number;
  seed?: string;
  network?: ReplayNetwork;
}) {
  const seed = options.seed ?? CORPUS_CONFIG.seed;
  const network = options.network ?? "ethereum";
  const selected = selectCandidates(
    options.candidates,
    seed,
    options.count,
    network,
  );
  options.store.sqlite
    .transaction(() => {
      selected.forEach((candidate, ordinal) => {
        options.store.sqlite
          .query(
            "INSERT OR IGNORE INTO scenario_candidates(id, run_id, ordinal, token_address, token_name, token_symbol, as_of_date, config_version, seed, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SELECTED')",
          )
          .run(
            randomUUID(),
            options.runId,
            ordinal,
            network === "solana"
              ? candidate.token_address
              : candidate.token_address.toLowerCase(),
            candidate.token_name ?? candidate.token_symbol,
            candidate.token_symbol,
            options.asOf,
            CORPUS_CONFIG.version,
            seed,
          );
      });
    })
    .immediate();
  return selected.length;
}

export function auditCorpus(store: Store, runId?: string) {
  const where = runId ? " WHERE run_id = ?" : "";
  const rows = store.sqlite
    .query(
      `SELECT status, COUNT(*) AS count FROM scenario_candidates${where} GROUP BY status`,
    )
    .all(...(runId ? [runId] : [])) as { status: string; count: number }[];
  const counts = Object.fromEntries(rows.map((row) => [row.status, row.count]));
  const completeQuery = runId
    ? "SELECT scenario_version AS version FROM scenario_candidates WHERE run_id = ? AND status = 'COMPLETE'"
    : "SELECT scenario_version AS version FROM scenario_candidates WHERE status = 'COMPLETE'";
  const completed = store.sqlite
    .query(completeQuery)
    .all(...(runId ? [runId] : [])) as { version: string }[];
  let missingEvidence = 0;
  let scored = 0;
  for (const row of completed) {
    const scenario = store.scenario(row.version);
    if (
      Object.values(scenario.evidence).some(
        (measurement) => measurement.status === "unavailable",
      )
    )
      missingEvidence += 1;
    if (
      executionPrices(
        scenario.future,
        scenario.entryAt,
        scenario.exitAt,
        scenario.assumptions,
      )
    )
      scored += 1;
  }
  const displayed = store.sqlite
    .query(
      `SELECT COUNT(*) AS count FROM rounds r JOIN scenario_candidates c ON c.scenario_version = r.version${runId ? " WHERE c.run_id = ?" : ""}`,
    )
    .get(...(runId ? [runId] : [])) as { count: number };
  return {
    attempted: rows.reduce((total, row) => total + row.count, 0),
    inputRejects: counts.INPUT_REJECTED ?? 0,
    missingEvidence,
    missingOutcomes: counts.MISSING_OUTCOME ?? 0,
    scored,
    displayed: displayed.count,
    statuses: counts,
  };
}
