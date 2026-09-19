import { describe, expect, it } from "vitest";
import {
  HOUR,
  evaluateRule,
  holderEvidence,
  measurement,
  simulate,
  timePolicy,
  visibleChart,
} from "../../src/domain/engine";
import { assumptions, type Candle } from "../../src/domain/model";

function history(
  values = Array.from({ length: 720 }, (_, index) => 100 + index),
) {
  const boundary = Date.parse("2026-08-02T00:00:00.000Z");

  return values.map((close, index): Candle => {
    const openAt = boundary - (720 - index) * HOUR;
    return {
      openAt: new Date(openAt).toISOString(),
      closeAtExclusive: new Date(openAt + HOUR).toISOString(),
      open: close,
      high: close,
      low: close,
      close,
      volumeUsd: null,
    };
  });
}

describe("UTC timing and visible-only chart preparation", () => {
  it("derives cutoff, entry, and exit across month and year boundaries", () => {
    expect(timePolicy("2026-08-01")).toEqual({
      cutoff: "2026-08-02T00:00:00.000Z",
      entryAt: "2026-08-03T00:00:00.000Z",
      exitAt: "2026-08-04T00:00:00.000Z",
    });
    expect(timePolicy("2026-12-31")).toEqual({
      cutoff: "2027-01-01T00:00:00.000Z",
      entryAt: "2027-01-02T00:00:00.000Z",
      exitAt: "2027-01-03T00:00:00.000Z",
    });
    expect(timePolicy("2026-08-01", "SEVEN_DAYS").exitAt).toBe(
      "2026-08-10T00:00:00.000Z",
    );
  });

  it("rejects a candle that closes after the cutoff", () => {
    const candles = history();
    candles[719] = {
      ...candles[719]!,
      closeAtExclusive: "2026-08-02T00:00:00.001Z",
    };

    expect(() =>
      visibleChart(candles, "2026-08-02T00:00:00.000Z", assumptions),
    ).toThrow("INCOMPLETE_HISTORY");
  });

  it("rejects a non-finite padded axis", () => {
    const values = Array.from({ length: 720 }, (_, index) =>
      index === 719 ? 1.6e306 : 1,
    );

    expect(() =>
      visibleChart(history(values), "2026-08-02T00:00:00.000Z", assumptions),
    ).toThrow("INVALID_HISTORY");
  });
});

describe("evidence and fixed rule", () => {
  const holders = Array.from({ length: 10 }, (_, index) => ({
    address: `holder-${index}`,
    amount: 100 - index,
    ownershipFraction: 0.02,
    change7d: 1,
  }));

  it("treats ownership as fractions and preserves token-unit changes", () => {
    expect(holderEvidence(holders, true)).toEqual({
      concentrationPercent: { status: "available", value: 20 },
      balanceChangeTokens: { status: "available", value: 10 },
    });
  });

  it("abstains when required evidence is missing and preserves zero", () => {
    expect(
      evaluateRule({
        flowUsd: measurement(null),
        concentrationPercent: measurement(0),
        balanceChangeTokens: measurement(0),
      }).action,
    ).toBe("ABSTAIN");

    expect(
      evaluateRule({
        flowUsd: measurement(0),
        concentrationPercent: measurement(0),
        balanceChangeTokens: measurement(0),
      }).action,
    ).toBe("CASH");
  });
});

describe("simulation", () => {
  const zeroCosts = { ...assumptions, fee: 0, slippage: 0 };

  it("uses the same modeled execution for expected rising, falling, and cash cases", () => {
    expect(simulate("BUY", 100, 110, zeroCosts)?.terminal).toBeCloseTo(1100);
    expect(simulate("BUY", 100, 90, zeroCosts)?.terminal).toBeCloseTo(900);
    expect(simulate("CASH", 100, 110, zeroCosts)?.terminal).toBe(1000);
  });

  it("does not overspend capital when entry fees apply", () => {
    expect(
      simulate("BUY", 100, 100, { ...assumptions, fee: 0.01, slippage: 0 })
        ?.terminal,
    ).toBeCloseTo((1000 * 0.99) / 1.01);
  });
});
