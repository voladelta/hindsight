import {
  intradayAssumptions,
  scenarioSchema,
  sevenDayAssumptions,
  type Candle,
  type RoundDuration,
  type Scenario,
} from "../../src/domain/model";
import {
  replayNetworkLabel,
  type ReplayNetwork,
} from "../../src/domain/replay-selection";
import {
  DAY,
  HOUR,
  evaluateRule,
  holderEvidence,
  measurement,
  timePolicy,
  visibleChart,
} from "../../src/domain/engine";
import { inputs, outcomes, type Store } from "../../src/server/db";

export const fixtureKinds = [
  "rising",
  "falling",
  "flat",
  "null-evidence",
  "missing-outcome",
  "extreme-price",
] as const;

export function fixtureScenario(
  index: number,
  duration: RoundDuration = "INTRADAY",
  network: ReplayNetwork = "ethereum",
): Scenario {
  const kind = fixtureKinds[index % fixtureKinds.length]!;
  const intraday = duration === "INTRADAY";
  const assumptions = intraday ? intradayAssumptions : sevenDayAssumptions;
  const times = timePolicy("2026-08-01", duration);
  const candleMilliseconds = intraday ? HOUR : DAY;
  const historyPoints = intraday ? 720 : 30;
  const scale = kind === "extreme-price" ? 1e-12 : 1;
  const candle = (openAt: number, value: number | null): Candle => ({
    openAt: new Date(openAt).toISOString(),
    closeAtExclusive: new Date(openAt + candleMilliseconds).toISOString(),
    open: value,
    high: value === null ? null : value * 1.015,
    low: value === null ? null : value * 0.985,
    close: value,
    volumeUsd: null,
  });
  const history = Array.from({ length: historyPoints }, (_, period) =>
    candle(
      Date.parse(times.cutoff) - (historyPoints - period) * candleMilliseconds,
      scale *
        (100 +
          period * (intraday ? 0.02 : 0.48) +
          Math.sin(period * (intraday ? 0.12 : 0.72)) * 4.6 +
          Math.cos(period * (intraday ? 0.31 : 1.8)) * 1.3),
    ),
  );
  const entry = history.at(-1)!.close! * 1.01;
  const trend =
    kind === "falling"
      ? intraday
        ? -0.0014
        : -0.032
      : kind === "flat"
        ? 0
        : intraday
          ? 0.0018
          : 0.041;
  const outcomePoints = intraday ? 25 : 8;
  const future = Array.from({ length: outcomePoints }, (_, period) =>
    candle(
      Date.parse(times.entryAt) + period * candleMilliseconds,
      kind === "missing-outcome" && period === outcomePoints - 1
        ? null
        : entry * (1 + period * trend),
    ),
  );
  const evidence = {
    flowUsd: measurement(
      kind === "null-evidence" ? null : kind === "falling" ? -420000 : 1240000,
    ),
    ...holderEvidence(
      Array.from({ length: 10 }, (_, holderIndex) => ({
        address: `invented-holder-${holderIndex}`,
        amount: 1000000 - holderIndex * 50000,
        ownershipFraction: 0.0284,
        change7d: kind === "falling" ? -25000 : 18600,
      })),
      true,
    ),
  };
  visibleChart(history, times.cutoff, assumptions);

  return scenarioSchema.parse({
    version: `test-${intraday ? "nansen-v2-intraday" : "nansen-v1"}-${kind}-${network}`,
    identity: {
      name: `Test ${["Fern", "Tide", "Stone", "Cloud", "Reed", "Spark"][index % 6]}`,
      symbol: `TST${(index % 6) + 1}`,
      chain: replayNetworkLabel(network),
    },
    ...times,
    history,
    future,
    evidence,
    opponent: evaluateRule(evidence),
    assumptions,
    preparedAt: "2026-09-14T00:00:00.000Z",
    source: intraday ? "nansen-v2" : "nansen-v1",
    provenance: {
      fetchedAt: "2026-09-14T00:00:00.000Z",
      providerVersion: "Invented Nansen-shaped test fixture",
      requestFingerprints: [],
      coverageWarnings: [],
    },
  });
}

export function seedFixtureScenarios(store: Store) {
  let ordinal = 0;

  for (const duration of ["INTRADAY", "SEVEN_DAYS"] as const) {
    for (const network of ["ethereum", "solana"] as const) {
      for (const index of fixtureKinds.keys()) {
        const scenario = fixtureScenario(index, duration, network);
        const { future, ...input } = scenario;

        store.db
          .insert(inputs)
          .values({
            version: scenario.version,
            payload: JSON.stringify(input),
            ordinal: ordinal++,
          })
          .run();
        store.db
          .insert(outcomes)
          .values({
            version: scenario.version,
            payload: JSON.stringify(future),
          })
          .run();
      }
    }
  }
}
