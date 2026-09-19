import { asString, parseCli, providerContext } from "../src/server/nansen/cli";
import { prepareOne } from "../src/server/nansen/preparation";
import { replayNetworkSchema } from "../src/domain/replay-selection";

async function main() {
  const options = parseCli(
    process.argv.slice(2),
    [
      "max-credits",
      "chain",
      "token",
      "as-of",
      "name",
      "symbol",
      "run-id",
      "duration",
    ],
    ["refresh"],
  );
  const network = replayNetworkSchema.safeParse(asString(options.chain));
  if (!network.success) throw new Error("--chain must be ethereum or solana.");
  const tokenAddress = asString(options.token);
  const asOf = asString(options["as-of"]);
  if (!tokenAddress) throw new Error("Provide --token with one token address.");
  if (!asOf) throw new Error("Provide --as-of as a UTC date.");
  const durationOption = asString(options.duration) ?? "intraday";
  if (durationOption !== "intraday" && durationOption !== "7d")
    throw new Error("--duration must be intraday or 7d.");

  const context = providerContext(options, 32);
  try {
    const scenario = await prepareOne({
      client: context.client,
      store: context.store,
      tokenAddress,
      asOf,
      name: asString(options.name),
      symbol: asString(options.symbol),
      network: network.data,
      duration: durationOption === "intraday" ? "INTRADAY" : "SEVEN_DAYS",
    });
    console.log("Prepared one private cached historical replay.");
    console.log(`Scenario version: ${scenario.version}`);
    console.log(`Prepared at: ${scenario.preparedAt}`);
    console.log(`Run ID: ${context.runId}`);
    console.log(`Effective local cap: ${context.maxCredits} credits`);
    console.log("Raw provider payloads remain in ignored local storage.");
  } finally {
    context.store.sqlite.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Preparation failed.");
  process.exitCode = 1;
});
