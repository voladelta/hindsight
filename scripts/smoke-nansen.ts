import { DAY } from "../src/domain/engine";
import { asString, parseCli, providerContext } from "../src/server/nansen/cli";
import { normalizePrices } from "../src/server/nansen/contracts";

async function main() {
  const options = parseCli(
    process.argv.slice(2),
    ["max-credits", "token", "token-address", "as-of", "run-id"],
    ["refresh"],
  );
  const context = providerContext(options, 1);
  try {
    const tokenAddress =
      asString(options.token) ?? asString(options["token-address"]);
    const asOf = asString(options["as-of"]);
    if (!tokenAddress || !/^0x[a-fA-F0-9]{40}$/.test(tokenAddress))
      throw new Error("Provide --token with one Ethereum address.");
    if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf))
      throw new Error("Provide --as-of=YYYY-MM-DD.");
    const asOfStart = Date.parse(`${asOf}T00:00:00.000Z`);
    if (
      !Number.isFinite(asOfStart) ||
      new Date(asOfStart).toISOString().slice(0, 10) !== asOf
    )
      throw new Error("--as-of must be a valid UTC calendar date.");

    const response = await context.client.request("prices", {
      chain: "ethereum",
      token_address: tokenAddress,
      timeframe: "1d",
      date: {
        from: new Date(asOfStart - 29 * DAY).toISOString(),
        to: new Date(asOfStart + DAY - 1).toISOString(),
      },
    });
    const normalized = normalizePrices(response.payload);
    console.log("Authenticated Nansen OHLCV smoke request succeeded.");
    console.log(`Fetched at: ${response.fetchedAt}`);
    console.log(`Rows: ${normalized.candles.length}`);
    console.log(`Request ID: ${response.requestId ?? "unavailable"}`);
    console.log(`Cache: ${response.cached ? "hit" : "network request"}`);
    console.log(`Request fingerprint: ${response.fingerprint}`);
    console.log(`Run ID: ${context.runId}`);
    console.log("The response body was not printed or committed.");
  } finally {
    context.store.sqlite.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Nansen smoke request failed.",
  );
  process.exitCode = 1;
});
