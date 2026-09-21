import { z } from "zod";

export const choiceSchema = z.enum(["BUY", "CASH"]);
export type Choice = z.infer<typeof choiceSchema>;
export const roundDurationSchema = z.enum(["INTRADAY", "SEVEN_DAYS"]);
export type RoundDuration = z.infer<typeof roundDurationSchema>;
export const stateSchema = z.enum(["BLIND", "EVIDENCE", "LOCKED", "REVEALED"]);
export type State = z.infer<typeof stateSchema>;
export const instantSchema = z.iso.datetime({ precision: 3 });
export const measurementSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), value: z.number().finite() }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.enum([
      "MISSING",
      "INCOMPLETE_HOLDERS",
      "INVALID_HOLDERS",
      "INCOMPLETE_DEX",
      "INVALID_DEX",
      "ZERO_DEX_VOLUME",
    ]),
  }),
]);
export type Measurement = z.infer<typeof measurementSchema>;
export const legacyEvidenceSchema = z.object({
  flowUsd: measurementSchema,
  concentrationPercent: measurementSchema,
  balanceChangeTokens: measurementSchema,
});
export const dexEvidenceSchema = z.object({
  tokenPressurePercent: measurementSchema,
  buyerCount: measurementSchema,
  sellerCount: measurementSchema,
  grossVolumeUsd: measurementSchema,
  concentrationPercent: measurementSchema,
});
export const evidenceSchema = z.union([
  dexEvidenceSchema,
  legacyEvidenceSchema,
]);
export type Evidence = z.infer<typeof evidenceSchema>;
export const DEX_RULE_VERSION = "smart-dex-accumulation-v1";
export const DEX_SCHEMA_VERSION = "smart-dex-evidence-v1";
const ruleVersionSchema = z.enum([
  "smart-flow-holder-balance-v1",
  DEX_RULE_VERSION,
]);
export const candleSchema = z.object({
  openAt: instantSchema,
  closeAtExclusive: instantSchema,
  open: z.number().finite().nullable(),
  high: z.number().finite().nullable(),
  low: z.number().finite().nullable(),
  close: z.number().finite().nullable(),
  volumeUsd: z.number().finite().nonnegative().nullable(),
});
export type Candle = z.infer<typeof candleSchema>;
const legacyAssumptionsSchema = z.object({
  capital: z.number().positive().finite(),
  fee: z.number().min(0).lt(1),
  slippage: z.number().min(0).lt(1),
  delayHours: z.literal(24),
  holdingDays: z.literal(7),
  ruleVersion: ruleVersionSchema,
});

const intradayAssumptionsSchema = z.object({
  capital: z.number().positive().finite(),
  fee: z.number().min(0).lt(1),
  slippage: z.number().min(0).lt(1),
  delayHours: z.literal(24),
  candleHours: z.literal(1),
  historyHours: z.literal(720),
  holdingHours: z.literal(24),
  ruleVersion: ruleVersionSchema,
});

export const assumptionsSchema = z.union([
  intradayAssumptionsSchema,
  legacyAssumptionsSchema,
]);
export const intradayAssumptions = assumptionsSchema.parse({
  capital: 1000,
  fee: 0.001,
  slippage: 0.0025,
  delayHours: 24,
  candleHours: 1,
  historyHours: 720,
  holdingHours: 24,
  ruleVersion: DEX_RULE_VERSION,
});
export const sevenDayAssumptions = assumptionsSchema.parse({
  capital: 1000,
  fee: 0.001,
  slippage: 0.0025,
  delayHours: 24,
  holdingDays: 7,
  ruleVersion: DEX_RULE_VERSION,
});
export const assumptions = intradayAssumptions;
export const opponentSchema = z.object({
  action: z.enum(["BUY", "CASH", "ABSTAIN"]),
  explanation: z.string(),
});
export type Opponent = z.infer<typeof opponentSchema>;
export const scenarioSchema = z
  .object({
    version: z.string(),
    identity: z.object({
      name: z.string(),
      symbol: z.string(),
      // Keep the legacy BNB value readable for already-persisted private rounds.
      chain: z.enum(["Ethereum", "Solana", "BNB Chain (BSC)"]),
    }),
    cutoff: instantSchema,
    entryAt: instantSchema,
    exitAt: instantSchema,
    history: z.array(candleSchema),
    future: z.array(candleSchema),
    evidence: evidenceSchema,
    opponent: opponentSchema,
    assumptions: assumptionsSchema,
    preparedAt: instantSchema,
    source: z.enum(["nansen-v1", "nansen-v2"]),
    provenance: z
      .object({
        fetchedAt: instantSchema,
        providerVersion: z.string(),
        requestFingerprints: z.array(z.string()),
        coverageWarnings: z.array(z.string()),
        selectionPolicy: z.string().optional(),
      })
      .optional(),
  })
  .refine(
    (scenario) =>
      "tokenPressurePercent" in scenario.evidence ===
      (scenario.assumptions.ruleVersion === DEX_RULE_VERSION),
    "Evidence schema must match the frozen rule version",
  );
export type Scenario = z.infer<typeof scenarioSchema>;
export const roundSchema = z.discriminatedUnion("state", [
  z.object({ id: z.uuid(), state: z.literal("BLIND") }),
  z.object({
    id: z.uuid(),
    state: z.literal("EVIDENCE"),
    initial: choiceSchema,
  }),
  z.object({
    id: z.uuid(),
    state: z.literal("LOCKED"),
    initial: choiceSchema,
    final: choiceSchema,
  }),
  z.object({
    id: z.uuid(),
    state: z.literal("REVEALED"),
    initial: choiceSchema,
    final: choiceSchema,
  }),
]);
export type Round = z.infer<typeof roundSchema>;
