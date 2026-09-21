import Decimal from "decimal.js";
import {
  assumptionsSchema,
  type Candle,
  type Choice,
  type Evidence,
  type Measurement,
  type Opponent,
  type RoundDuration,
} from "./model";

export const DAY = 86_400_000;
export const HOUR = 3_600_000;

export function priceTimeframe(
  config: Parameters<typeof assumptionsSchema.parse>[0],
) {
  const parsed = assumptionsSchema.parse(config);
  if ("holdingHours" in parsed) {
    return {
      candleMilliseconds: parsed.candleHours * HOUR,
      historyPoints: parsed.historyHours / parsed.candleHours,
      unit: "hour" as const,
    };
  }

  return {
    candleMilliseconds: DAY,
    historyPoints: 30,
    unit: "day" as const,
  };
}

export function timePolicy(asOf: string, duration: RoundDuration = "INTRADAY") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("Invalid UTC date");
  const date = Date.parse(`${asOf}T00:00:00.000Z`);
  if (
    !Number.isFinite(date) ||
    new Date(date).toISOString().slice(0, 10) !== asOf
  )
    throw new Error("Invalid UTC date");
  return {
    cutoff: new Date(date + DAY).toISOString(),
    entryAt: new Date(date + 2 * DAY).toISOString(),
    exitAt: new Date(
      date + (duration === "INTRADAY" ? 3 : 9) * DAY,
    ).toISOString(),
  };
}

export function visibleChart(
  candles: Candle[],
  cutoff: string,
  config: Parameters<typeof assumptionsSchema.parse>[0],
  truncated = false,
) {
  const boundary = Date.parse(cutoff);
  const timeframe = priceTimeframe(config);
  const visible = candles.filter(
    (c) => Date.parse(c.closeAtExclusive) <= boundary,
  );
  if (truncated || visible.length !== timeframe.historyPoints)
    throw new Error("INCOMPLETE_HISTORY");
  for (const [index, candle] of visible.entries()) {
    const expected =
      boundary -
      (timeframe.historyPoints - index) * timeframe.candleMilliseconds;
    if (
      Date.parse(candle.openAt) !== expected ||
      Date.parse(candle.closeAtExclusive) !==
        expected + timeframe.candleMilliseconds ||
      !positive(candle.close)
    ) {
      throw new Error("INVALID_HISTORY");
    }
  }
  const base = visible[0]!.close!;
  const points = visible.map((c, i) => ({
    period: i + 1,
    price: new Decimal(c.close!).div(base).mul(100).toNumber(),
  }));
  if (points.some((p) => !Number.isFinite(p.price)))
    throw new Error("INVALID_HISTORY");
  const values = points.map((p) => p.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.15, 1);
  const axis: [number, number] = [Math.max(0, min - padding), max + padding];
  if (!axis.every(Number.isFinite)) throw new Error("INVALID_HISTORY");

  return { points, axis, unit: timeframe.unit };
}

export function measurement(value: number | null | undefined): Measurement {
  return typeof value === "number" && Number.isFinite(value)
    ? { status: "available", value }
    : { status: "unavailable", reason: "MISSING" };
}

export type Holder = {
  address: string;
  amount: number;
  ownershipFraction: number | null;
  change7d: number | null;
};
export function holderEvidence(holders: Holder[], sortVerified: boolean) {
  const unavailable = (reason: "INCOMPLETE_HOLDERS" | "INVALID_HOLDERS") => ({
    concentrationPercent: { status: "unavailable", reason } as Measurement,
    balanceChangeTokens: { status: "unavailable", reason } as Measurement,
  });
  if (holders.length !== 10) return unavailable("INCOMPLETE_HOLDERS");
  if (
    !sortVerified ||
    new Set(holders.map((h) => h.address.toLowerCase())).size !== 10 ||
    holders.some(
      (h, i) =>
        !Number.isFinite(h.amount) ||
        h.amount < 0 ||
        (i > 0 && h.amount > holders[i - 1]!.amount),
    )
  )
    return unavailable("INVALID_HOLDERS");

  const fractions = holders.map((h) => h.ownershipFraction);
  const validFractions = fractions.every(
    (v) => v !== null && Number.isFinite(v) && v >= 0 && v <= 1,
  );
  const sum = validFractions
    ? fractions.reduce<number>((total, v) => total + v!, 0)
    : null;
  const changes = holders.map((h) => h.change7d);
  return {
    // 1e-9 accommodates floating-point addition only; it is not a coverage allowance.
    concentrationPercent:
      sum !== null && sum <= 1 + 1e-9
        ? measurement(Math.min(sum, 1) * 100)
        : unavailable("INVALID_HOLDERS").concentrationPercent,
    balanceChangeTokens: changes.every((v) => v !== null && Number.isFinite(v))
      ? measurement(changes.reduce<number>((total, v) => total + v!, 0))
      : measurement(null),
  };
}

export function evaluateRule(evidence: Evidence): Opponent {
  if ("tokenPressurePercent" in evidence) {
    const { tokenPressurePercent, buyerCount, sellerCount } = evidence;
    if (
      tokenPressurePercent.status === "available" &&
      buyerCount.status === "available" &&
      sellerCount.status === "available"
    ) {
      if (
        buyerCount.value >= 2 &&
        buyerCount.value > sellerCount.value &&
        tokenPressurePercent.value > 0
      ) {
        return {
          action: "BUY",
          explanation:
            "At least two Smart Money wallets accumulated tokens, net buyers outnumbered net sellers, and token accumulation pressure was positive.",
        };
      }
      if (
        sellerCount.value >= 2 &&
        sellerCount.value > buyerCount.value &&
        tokenPressurePercent.value < 0
      ) {
        return {
          action: "CASH",
          explanation:
            "At least two Smart Money wallets distributed tokens, net sellers outnumbered net buyers, and token accumulation pressure was negative. The rule chooses SELL.",
        };
      }
    }
    return {
      action: "ABSTAIN",
      explanation:
        "Token pressure and wallet breadth do not agree, fewer than two wallets support a direction, or complete DEX evidence is unavailable.",
    };
  }

  // Stored legacy rounds retain their original evidence and fixed rule.
  const { flowUsd, balanceChangeTokens } = evidence;
  if (
    flowUsd.status === "unavailable" ||
    balanceChangeTokens.status === "unavailable"
  ) {
    return {
      action: "ABSTAIN",
      explanation:
        "Required historical evidence is unavailable. The rule does not make a scored choice.",
    };
  }
  if (flowUsd.value > 0 && balanceChangeTokens.value >= 0) {
    return {
      action: "BUY",
      explanation:
        "Smart Trader net flow is positive and selected holders’ net balance change is nonnegative.",
    };
  }
  return {
    action: "CASH",
    explanation:
      "Smart Trader net flow is nonpositive or selected holders’ net balance change is negative.",
  };
}

export type DexWallet = {
  boughtTokens: number;
  soldTokens: number;
  grossUsd: number;
};

export function dexEvidence(
  wallets: DexWallet[] | null,
  reason: "INCOMPLETE_DEX" | "INVALID_DEX" = "INVALID_DEX",
) {
  const unavailable = (
    failure: "INCOMPLETE_DEX" | "INVALID_DEX" | "ZERO_DEX_VOLUME",
  ) => {
    const item: Measurement = { status: "unavailable", reason: failure };
    return {
      tokenPressurePercent: item,
      buyerCount: item,
      sellerCount: item,
      grossVolumeUsd: item,
    };
  };
  if (wallets === null) return unavailable(reason);

  let bought = new Decimal(0);
  let sold = new Decimal(0);
  let grossUsd = new Decimal(0);
  let buyers = 0;
  let sellers = 0;
  for (const wallet of wallets) {
    bought = bought.plus(wallet.boughtTokens);
    sold = sold.plus(wallet.soldTokens);
    grossUsd = grossUsd.plus(wallet.grossUsd);
    if (wallet.boughtTokens > wallet.soldTokens) buyers += 1;
    if (wallet.soldTokens > wallet.boughtTokens) sellers += 1;
  }
  const denominator = bought.plus(sold);
  if (denominator.isZero()) return unavailable("ZERO_DEX_VOLUME");
  const pressure = bought.minus(sold).div(denominator).mul(100).toNumber();
  if (!Number.isFinite(pressure) || !Number.isFinite(grossUsd.toNumber()))
    return unavailable("INVALID_DEX");

  return {
    tokenPressurePercent: measurement(pressure),
    buyerCount: measurement(buyers),
    sellerCount: measurement(sellers),
    grossVolumeUsd: measurement(grossUsd.toNumber()),
  };
}

export function positive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function executionPrices(
  candles: Candle[],
  entryAt: string,
  exitAt: string,
  config: Parameters<typeof assumptionsSchema.parse>[0],
) {
  const { candleMilliseconds } = priceTimeframe(config);
  const at = (time: string) =>
    candles.filter(
      (c) =>
        c.openAt === time &&
        Date.parse(c.closeAtExclusive) ===
          Date.parse(time) + candleMilliseconds,
    );
  const entries = at(entryAt);
  const exits = at(exitAt);
  if (
    entries.length !== 1 ||
    exits.length !== 1 ||
    !positive(entries[0]!.open) ||
    !positive(exits[0]!.open)
  )
    return null;
  return { entry: entries[0]!.open, exit: exits[0]!.open };
}

export function simulate(
  action: Choice | "ABSTAIN",
  entry: number | null,
  exit: number | null,
  config: Parameters<typeof assumptionsSchema.parse>[0],
) {
  const { capital, fee, slippage } = assumptionsSchema.parse(config);
  if (action === "ABSTAIN" || !positive(entry) || !positive(exit)) return null;
  const terminal =
    action === "CASH"
      ? capital
      : new Decimal(capital)
          .div(
            new Decimal(entry)
              .mul(new Decimal(1).plus(slippage))
              .mul(new Decimal(1).plus(fee)),
          )
          .mul(new Decimal(exit).mul(new Decimal(1).minus(slippage)))
          .mul(new Decimal(1).minus(fee))
          .toNumber();
  if (!Number.isFinite(terminal)) return null;
  return {
    terminal,
    pnl: terminal - capital,
    returnPercent: (terminal / capital - 1) * 100,
  };
}
