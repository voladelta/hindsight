import { z } from "zod";
import Decimal from "decimal.js";
import type { Candle } from "../../domain/model";
import { DAY, type Holder, type DexWallet } from "../../domain/engine";
import type { ReplayNetwork } from "../../domain/replay-selection";

export const DEX_NORMALIZER_VERSION = "smart-dex-normalizer-v1";
export const SMART_TRADER_LABELS = [
  "30D Smart Trader",
  "90D Smart Trader",
  "180D Smart Trader",
  "Smart Trader",
  "30D Smart Dex Trader",
  "90D Smart Dex Trader",
  "180D Smart Dex Trader",
  "Smart Dex Trader",
];

const dexRow = z.object({
  address: z.string().min(1),
  is_smart_money: z.literal(true),
  bought_token_volume: z.number().finite().nonnegative(),
  sold_token_volume: z.number().finite().nonnegative(),
  gross_token_volume: z.number().finite().nonnegative(),
  bought_volume_usd: z.number().finite().nonnegative(),
  sold_volume_usd: z.number().finite().nonnegative(),
  gross_volume_usd: z.number().finite().nonnegative(),
});
const dexResponse = z.object({
  data: z.array(dexRow).max(1000),
  pagination: z.object({ is_last_page: z.boolean() }),
  truncated: z.boolean().optional(),
  warnings: z.array(z.unknown()).nullish(),
});

export function normalizeDex(
  buyRaw: unknown,
  sellRaw: unknown,
  network: ReplayNetwork,
): { wallets: DexWallet[] | null; reason?: "INCOMPLETE_DEX" | "INVALID_DEX" } {
  const buy = dexResponse.safeParse(buyRaw);
  const sell = dexResponse.safeParse(sellRaw);
  if (!buy.success || !sell.success)
    return { wallets: null, reason: "INVALID_DEX" };
  const sides = [buy.data, sell.data];
  if (
    sides.some(
      (side) =>
        !side.pagination.is_last_page ||
        side.truncated ||
        side.warnings?.length,
    )
  )
    return { wallets: null, reason: "INCOMPLETE_DEX" };

  const unique = new Map<
    string,
    { row: z.infer<typeof dexRow>; side: number }
  >();
  for (const [side, response] of sides.entries()) {
    for (const row of response.data) {
      const validAddress =
        network === "solana"
          ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.address)
          : /^0x[a-fA-F0-9]{40}$/.test(row.address);
      const address =
        network === "solana" ? row.address : row.address.toLowerCase();
      const directionUsd = new Decimal(
        side === 0 ? row.bought_volume_usd : row.sold_volume_usd,
      ).minus(side === 0 ? row.sold_volume_usd : row.bought_volume_usd);
      const matchesGross = (bought: number, sold: number, gross: number) =>
        new Decimal(bought)
          .plus(sold)
          .minus(gross)
          .abs()
          .lte(new Decimal(gross).mul(1e-9));
      if (
        !validAddress ||
        directionUsd.lt(10) ||
        !matchesGross(
          row.bought_token_volume,
          row.sold_token_volume,
          row.gross_token_volume,
        ) ||
        !matchesGross(
          row.bought_volume_usd,
          row.sold_volume_usd,
          row.gross_volume_usd,
        )
      )
        return { wallets: null, reason: "INVALID_DEX" };

      const canonical = { ...row, address };
      const previous = unique.get(address);
      if (
        previous &&
        (previous.side !== side ||
          JSON.stringify(previous.row) !== JSON.stringify(canonical))
      )
        return { wallets: null, reason: "INVALID_DEX" };
      unique.set(address, { row: canonical, side });
    }
  }
  return {
    wallets: [...unique.values()].map(({ row }) => ({
      boughtTokens: row.bought_token_volume,
      soldTokens: row.sold_token_volume,
      grossUsd: row.gross_volume_usd,
    })),
  };
}

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
