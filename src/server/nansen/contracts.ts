import { z } from "zod";
import type { Candle } from "../../domain/model";
import { DAY, type Holder } from "../../domain/engine";

const nullableFinite = z.number().finite().nullable().optional();
const envelope = <T extends z.ZodType>(item: T) =>
  z
    .object({
      data: z.array(item),
      truncated: z.boolean().optional(),
      warnings: z.array(z.unknown()).nullish(),
    })
    .passthrough();

const priceRow = z
  .object({
    interval_start: z.union([z.string(), z.number()]),
    open: nullableFinite,
    high: nullableFinite,
    low: nullableFinite,
    close: nullableFinite,
    volume_usd: nullableFinite,
    volume: nullableFinite,
    token_name: z.string().optional(),
    token_symbol: z.string().optional(),
  })
  .passthrough();

const flowRow = z
  .object({ smart_trader_net_flow_usd: nullableFinite })
  .passthrough();

const holderRow = z
  .object({
    address: z.string().min(1),
    token_amount: z.number().finite(),
    ownership_percentage: nullableFinite,
    balance_change_7d: nullableFinite,
  })
  .passthrough();

const screenerRow = z
  .object({
    token_address: z.string().min(1),
    token_name: z.string().min(1).optional(),
    token_symbol: z.string().min(1),
    volume: nullableFinite,
    liquidity: nullableFinite,
  })
  .passthrough();

export const nansenSchemas = {
  prices: envelope(priceRow),
  flow: envelope(flowRow),
  holders: envelope(holderRow).extend({
    pagination: z
      .object({ is_last_page: z.boolean().optional() })
      .passthrough()
      .optional(),
  }),
  screener: envelope(screenerRow).extend({
    pagination: z
      .object({ is_last_page: z.boolean().optional() })
      .passthrough()
      .optional(),
  }),
};

function instant(value: string | number) {
  if (typeof value === "number" && !Number.isInteger(value))
    throw new Error("NANSEN_AMBIGUOUS_TIMESTAMP");
  const milliseconds =
    typeof value === "number"
      ? value >= 1e12
        ? value
        : value >= 1e9
          ? value * 1000
          : Number.NaN
      : Date.parse(value);
  if (!Number.isFinite(milliseconds))
    throw new Error("NANSEN_INVALID_TIMESTAMP");
  return new Date(milliseconds).toISOString();
}

export function normalizePrices(raw: unknown, candleMilliseconds = DAY) {
  const parsed = nansenSchemas.prices.parse(raw);
  if (parsed.truncated) throw new Error("NANSEN_TRUNCATED_PRICES");

  const candles: Candle[] = parsed.data.map((row) => {
    const openAt = instant(row.interval_start);
    return {
      openAt,
      closeAtExclusive: new Date(
        Date.parse(openAt) + candleMilliseconds,
      ).toISOString(),
      open: row.open ?? null,
      high: row.high ?? null,
      low: row.low ?? null,
      close: row.close ?? null,
      volumeUsd: row.volume_usd ?? row.volume ?? null,
    };
  });
  candles.sort((a, b) => Date.parse(a.openAt) - Date.parse(b.openAt));
  if (new Set(candles.map((candle) => candle.openAt)).size !== candles.length)
    throw new Error("NANSEN_DUPLICATE_PRICE");

  const first = parsed.data[0];
  return {
    candles,
    identity: {
      name: first?.token_name,
      symbol: first?.token_symbol,
    },
  };
}

export function normalizeFlow(raw: unknown) {
  const parsed = nansenSchemas.flow.parse(raw);
  if (parsed.data.length === 0) return null;
  if (parsed.data.length !== 1) throw new Error("NANSEN_AMBIGUOUS_FLOW");
  return parsed.data[0]!.smart_trader_net_flow_usd ?? null;
}

export function normalizeHolders(raw: unknown): {
  holders: Holder[];
  sortVerified: boolean;
} {
  const parsed = nansenSchemas.holders.parse(raw);
  const holders = parsed.data.map((row) => ({
    address: row.address,
    amount: row.token_amount,
    ownershipFraction: row.ownership_percentage ?? null,
    change7d: row.balance_change_7d ?? null,
  }));
  return {
    holders,
    sortVerified: holders.every(
      (holder, index) =>
        index === 0 || holder.amount <= holders[index - 1]!.amount,
    ),
  };
}

export type UniverseCandidate = z.infer<typeof screenerRow>;
export function normalizeUniverse(raw: unknown) {
  return nansenSchemas.screener.parse(raw).data;
}

export function hasProviderWarnings(raw: unknown) {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "warnings" in raw &&
    Array.isArray(raw.warnings) &&
    raw.warnings.length > 0
  );
}
