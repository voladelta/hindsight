import {
  executionPrices,
  positive,
  priceTimeframe,
  simulate,
  visibleChart,
} from "./engine";
import type { Round, Scenario } from "./model";

export function publicRound(round: Round, scenario: Scenario) {
  const timeframe = priceTimeframe(scenario.assumptions);
  const base = {
    id: round.id,
    chart: visibleChart(
      scenario.history,
      scenario.cutoff,
      scenario.assumptions,
    ),
    sourceLabel: "Cached historical replay — Powered by Nansen API" as const,
    assumptions: { ...scenario.assumptions },
  };
  if (round.state === "BLIND") return { ...base, state: "BLIND" as const };
  const evidence = {
    flowUsd: { ...scenario.evidence.flowUsd },
    concentrationPercent: { ...scenario.evidence.concentrationPercent },
    balanceChangeTokens: { ...scenario.evidence.balanceChangeTokens },
  };
  const withEvidence = { ...base, initial: round.initial, evidence };
  if (round.state === "EVIDENCE")
    return { ...withEvidence, state: "EVIDENCE" as const };
  const locked = {
    ...withEvidence,
    final: round.final,
    opponent: {
      action: scenario.opponent.action,
      explanation: scenario.opponent.explanation,
    },
  };
  if (round.state === "LOCKED") return { ...locked, state: "LOCKED" as const };

  const prices = executionPrices(
    scenario.future,
    scenario.entryAt,
    scenario.exitAt,
    scenario.assumptions,
  );
  const result = (action: "BUY" | "CASH" | "ABSTAIN") =>
    simulate(
      action,
      prices?.entry ?? null,
      prices?.exit ?? null,
      scenario.assumptions,
    );
  const original = result(round.initial);
  const revised = result(round.final);
  const opponent = result(scenario.opponent.action);
  const alwaysBuy = result("BUY");
  const isScored =
    prices !== null &&
    original !== null &&
    revised !== null &&
    alwaysBuy !== null &&
    (scenario.opponent.action === "ABSTAIN" || opponent !== null);

  return {
    ...locked,
    state: "REVEALED" as const,
    identity: {
      name: scenario.identity.name,
      symbol: scenario.identity.symbol,
      chain: scenario.identity.chain,
    },
    cutoff: scenario.cutoff,
    entryAt: scenario.entryAt,
    exitAt: scenario.exitAt,
    outcome: {
      status: isScored ? ("SCORED" as const) : ("UNSCORABLE" as const),
      points: scenario.future.map((c) => ({
        period:
          timeframe.historyPoints +
          1 +
          (Date.parse(c.openAt) - Date.parse(scenario.cutoff)) /
            timeframe.candleMilliseconds,
        price: normalizedOutcomePrice(c.open, scenario.history[0]!.close),
      })),
      original: isScored ? original : null,
      revised: isScored ? revised : null,
      opponent: isScored ? opponent : null,
      alwaysBuy: isScored ? alwaysBuy : null,
      revisionDeltaUsd: isScored ? revised.terminal - original.terminal : null,
      revisionDeltaPercentagePoints: isScored
        ? (100 * (revised.terminal - original.terminal)) /
          scenario.assumptions.capital
        : null,
    },
  };
}

function normalizedOutcomePrice(value: number | null, base: number | null) {
  if (!positive(value) || !positive(base)) return null;

  const normalized = (value / base) * 100;
  return Number.isFinite(normalized) ? normalized : null;
}
export type RoundDTO = ReturnType<typeof publicRound>;

export function publicProvenance(scenario: Scenario) {
  const timeframe = priceTimeframe(scenario.assumptions);
  return {
    source: "Cached historical replay — Powered by Nansen API",
    version: scenario.version,
    inputCutoffExclusive: scenario.cutoff,
    assumedAvailabilityDelayHours: 24,
    entryAt: scenario.entryAt,
    exitAt: scenario.exitAt,
    preparedAt: scenario.preparedAt,
    fetchedAt: scenario.provenance?.fetchedAt ?? null,
    providerVersion: scenario.provenance?.providerVersion ?? scenario.source,
    ruleVersion: scenario.assumptions.ruleVersion,
    ruleInputs: scenario.evidence,
    ruleOutput: scenario.opponent.action,
    priceReference: `${timeframe.unit === "hour" ? "Hourly" : "Daily"} opening price at exact entry and exit; no shifted or filled references.`,
    coverage: {
      flow: scenario.evidence.flowUsd.status,
      concentration: scenario.evidence.concentrationPercent.status,
      holderBalance: scenario.evidence.balanceChangeTokens.status,
      outcome: executionPrices(
        scenario.future,
        scenario.entryAt,
        scenario.exitAt,
        scenario.assumptions,
      )
        ? "available"
        : "unscorable",
    },
    requestFingerprints: scenario.provenance?.requestFingerprints ?? [],
    providerWarnings: scenario.provenance?.coverageWarnings ?? [],
    notices: [
      "Cached historical reconstruction; playback is not a fresh API response.",
      "Historical reconstructions are not certified recordings of what was published at the time. A 24-hour buffer does not prove historical availability.",
      "Holders are selected at the cutoff. Balance changes are not proof of trades or sales.",
      "Fees of 0.1% and slippage of 0.25% apply on each side. Price references are not guaranteed executable quotes.",
      "A revision’s result is descriptive, not evidence of investment edge or a causal effect.",
    ],
  };
}
export type ProvenanceDTO = ReturnType<typeof publicProvenance>;
