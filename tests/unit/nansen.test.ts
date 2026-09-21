import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { openStore, inputs, outcomes, type Store } from "../../src/server/db";
import { publicRound } from "../../src/domain/dto";
import { measurement } from "../../src/domain/engine";
import {
  createNansenClient,
  NansenError,
} from "../../src/server/nansen/client";
import {
  normalizeHolders,
  normalizeDex,
  SMART_TRADER_LABELS,
  normalizePrices,
  type UniverseCandidate,
} from "../../src/server/nansen/contracts";
import {
  fetchUniverse,
  freezeCandidates,
  prepareOne,
  selectCandidates,
} from "../../src/server/nansen/preparation";

let store: Store | undefined;
afterEach(() => store?.sqlite.close());

function client(
  fetcher: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
  maxCredits = 10,
  maxRetries = 1,
) {
  store = openStore(":memory:");
  return createNansenClient({
    store,
    apiKey: "test-key-never-sent-to-a-real-server",
    credentialNamespace: "test",
    runId: crypto.randomUUID(),
    maxCredits,
    maxRetries,
    minIntervalMs: 0,
    fetch: fetcher,
  });
}

describe("Nansen transport controls", () => {
  it("queries the requested historical screener network", async () => {
    const requestBodies: unknown[] = [];
    const nansen = client(async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "x-nansen-credits-used": "5" },
      });
    }, 10);

    await fetchUniverse(nansen, "2026-08-01", "solana");
    await fetchUniverse(nansen, "2026-08-01", "ethereum");

    expect(requestBodies[0]).toMatchObject({
      chains: ["solana"],
      sectors_filter: ["Memecoins", "AI Meme"],
      trader_type: "all",
      filters: {
        volume_usd: { min: 250000 },
        liquidity_usd: { min: 100000 },
        token_age_days: { min: 30 },
      },
    });
    expect(requestBodies[1]).toMatchObject({
      chains: ["ethereum"],
      trader_type: "all",
      exclude_sectors: ["Stablecoin"],
    });
    expect(requestBodies[1]).not.toHaveProperty("sectors_filter");
  });

  it("serves an identical request from private cache without another upstream call", async () => {
    let calls = 0;
    const nansen = client(async () => {
      calls += 1;
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: {
          "x-nansen-credits-used": "1",
          "x-request-id": "request-1",
        },
      });
    });

    const first = await nansen.request("prices", { token: "same" });
    const second = await nansen.request("prices", { token: "same" });

    expect(calls).toBe(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(
      store!.sqlite
        .query("SELECT kind FROM api_usage ORDER BY attempted_at")
        .all(),
    ).toEqual([{ kind: "request" }, { kind: "cache_hit" }]);
  });

  it("reserves each retry and does not retry authentication failures", async () => {
    let calls = 0;
    const retrying = client(async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: "temporary" }), {
        status: calls === 1 ? 500 : 200,
      });
    }, 2);

    await expect(retrying.request("prices", {})).resolves.toMatchObject({
      cached: false,
    });
    expect(calls).toBe(2);
    store!.sqlite.close();

    calls = 0;
    const unauthorized = client(async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: "no" }), { status: 401 });
    });
    await expect(unauthorized.request("prices", {})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(calls).toBe(1);
  });

  it("atomically prevents concurrent reservations from exceeding the run cap", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const nansen = client(
      async () => {
        await pending;
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
      1,
      0,
    );

    const first = nansen.request("prices", { id: 1 });
    const second = nansen.request("prices", { id: 2 });
    await expect(second).rejects.toBeInstanceOf(NansenError);
    release();
    await expect(first).resolves.toMatchObject({ cached: false });
  });

  it("keeps concurrent dispatches to one in-flight request", async () => {
    let active = 0;
    let maximumActive = 0;
    const nansen = client(
      async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Bun.sleep(5);
        active -= 1;
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
      2,
      0,
    );

    await Promise.all([
      nansen.request("prices", { id: 1 }),
      nansen.request("prices", { id: 2 }),
    ]);

    expect(maximumActive).toBe(1);
  });
});

describe("Nansen boundary normalization and selection", () => {
  it("rejects duplicate price instants and preserves holder fraction units", () => {
    const row = {
      interval_start: "2026-08-01T00:00:00.000Z",
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume_usd: null,
    };
    expect(() => normalizePrices({ data: [row, row] })).toThrow(
      "NANSEN_DUPLICATE_PRICE",
    );

    const normalized = normalizeHolders({
      data: Array.from({ length: 10 }, (_, index) => ({
        address: `0x${index}`,
        token_amount: 100 - index,
        ownership_percentage: 0.02,
        balance_change_7d: 0,
      })),
      pagination: { is_last_page: false },
    });
    expect(normalized.holders[0]!.ownershipFraction).toBe(0.02);
    expect(normalized.sortVerified).toBe(true);
    expect(() => normalizePrices({ data: [], warnings: null })).not.toThrow();
  });

  it("reproduces candidate order from inputs alone", () => {
    const candidates = Array.from({ length: 6 }, (_, index) => ({
      token_address: `0x${index.toString(16).padStart(40, "0")}`,
      token_name: `Token ${index}`,
      token_symbol: `T${index}`,
      volume: 1_000_000 - index,
      liquidity: 500_000,
    })) satisfies UniverseCandidate[];

    const first = selectCandidates(candidates, "fixed-seed", 4);
    const withUnrelatedFutureOutcomes = candidates.map((candidate, index) => ({
      ...candidate,
      futureReturnForTestOnly: index % 2 ? -0.99 : 4.2,
    }));
    const second = selectCandidates(
      withUnrelatedFutureOutcomes,
      "fixed-seed",
      4,
    );

    expect(second.map((item) => item.token_address)).toEqual(
      first.map((item) => item.token_address),
    );
  });

  it("resumes a frozen manifest without resetting completed candidates", () => {
    store = openStore(":memory:");
    const candidates = Array.from({ length: 2 }, (_, index) => ({
      token_address: `0x${index.toString(16).padStart(40, "0")}`,
      token_name: `Token ${index}`,
      token_symbol: `T${index}`,
      volume: 1_000_000,
      liquidity: 500_000,
    })) satisfies UniverseCandidate[];
    const options = {
      store,
      runId: "resume-test",
      asOf: "2026-08-01",
      candidates,
      count: 2,
      seed: "fixed",
    };
    freezeCandidates(options);
    store.sqlite
      .query(
        "UPDATE scenario_candidates SET status = 'COMPLETE' WHERE ordinal = 0",
      )
      .run();

    freezeCandidates(options);

    expect(
      store.sqlite
        .query("SELECT status FROM scenario_candidates ORDER BY ordinal")
        .all(),
    ).toEqual([{ status: "COMPLETE" }, { status: "SELECTED" }]);
  });

  it("preserves case-sensitive Solana token addresses in a frozen manifest", () => {
    store = openStore(":memory:");
    const candidates = [
      {
        token_address: "So11111111111111111111111111111111111111112",
        token_name: "Wrapped SOL",
        token_symbol: "SOL",
        volume: 1_000_000,
        liquidity: 500_000,
      },
    ] satisfies UniverseCandidate[];

    freezeCandidates({
      store,
      runId: "solana-case-test",
      asOf: "2026-08-01",
      candidates,
      count: 1,
      network: "solana",
    });

    expect(
      store.sqlite.query("SELECT token_address FROM scenario_candidates").get(),
    ).toEqual({ token_address: candidates[0]!.token_address });
  });

  it("prepares an immutable scenario from invented schema-shaped responses", async () => {
    store = openStore(":memory:");
    const requestedChains: string[] = [];
    const start = Date.parse("2026-07-03T00:00:00.000Z");
    const prices = (count: number, offset: number) => ({
      data: Array.from({ length: count }, (_, index) => ({
        interval_start: new Date(
          start + (offset + index) * 3_600_000,
        ).toISOString(),
        open: 100 + index,
        high: 101 + index,
        low: 99 + index,
        close: 100 + index,
        volume_usd: 1_000_000,
        token_name: "Invented Adapter Token",
        token_symbol: "IAT",
      })),
    });
    const nansen = createNansenClient({
      store,
      apiKey: "test-key",
      credentialNamespace: "test-prepare",
      runId: "prepare-test",
      maxCredits: 37,
      maxRetries: 0,
      minIntervalMs: 0,
      fetch: async (input, init) => {
        const url = String(input);
        const requestBody = JSON.parse(String(init?.body)) as {
          chain: string;
          date?: { from: string };
          buy_or_sell?: string;
        };
        requestedChains.push(requestBody.chain);
        if (url.includes("historical-who-bought-sold")) {
          expect(requestBody).toMatchObject({
            date_range: {
              from: "2026-07-26T00:00:00.000Z",
              to: "2026-08-01T23:59:59.999Z",
            },
            filters: {
              include_labels: SMART_TRADER_LABELS,
              trade_volume_usd: { min: 10 },
            },
            pagination: { page: 1, per_page: 1000 },
            order_by: [{ field: "gross_volume_usd", direction: "DESC" }],
          });
          expect(requestBody).not.toHaveProperty("apply_blacklist_filter");
          return new Response(
            JSON.stringify(
              dexPage(
                requestBody.buy_or_sell === "BUY"
                  ? [
                      dexRow("So11111111111111111111111111111111111111112"),
                      dexRow("So11111111111111111111111111111111111111113"),
                    ]
                  : [],
              ),
            ),
          );
        }
        if (url.includes("historical-top-holders"))
          return new Response(
            JSON.stringify({
              data: Array.from({ length: 10 }, (_, index) => ({
                address: `invented-${index}`,
                token_amount: 100 - index,
                ownership_percentage: 0.02,
                balance_change_7d: 1,
              })),
              warnings: ["invented warning text must not be public"],
            }),
          );
        return new Response(
          JSON.stringify(
            requestBody.date!.from.startsWith("2026-07")
              ? prices(720, 0)
              : prices(25, 744),
          ),
        );
      },
    });

    const scenario = await prepareOne({
      client: nansen,
      store,
      tokenAddress: "So11111111111111111111111111111111111111112",
      asOf: "2026-08-01",
      network: "solana",
    });

    expect(scenario.source).toBe("nansen-v2");
    expect(scenario.identity.chain).toBe("Solana");
    expect(requestedChains).toEqual([
      "solana",
      "solana",
      "solana",
      "solana",
      "solana",
    ]);
    expect(scenario.evidence.concentrationPercent).toEqual({
      status: "available",
      value: 20,
    });
    expect(scenario.opponent.action).toBe("BUY");
    expect(scenario.provenance?.coverageWarnings).toEqual([
      "HOLDERS_WARNING_PRESENT",
    ]);
    expect(JSON.stringify(scenario)).not.toContain("invented warning text");
    expect(store.scenario(scenario.version)).toEqual(scenario);

    for (const state of ["BLIND", "EVIDENCE", "LOCKED", "REVEALED"] as const) {
      const serialized = JSON.stringify(
        publicRound(
          {
            id: "11111111-1111-4111-8111-111111111111",
            state,
            initial: "BUY",
            final: "CASH",
          },
          scenario,
        ),
      );
      expect(serialized).not.toMatch(
        /So1111111111111111111111111111111111111111[23]|invented warning text|bought_token_volume|is_smart_money|address/,
      );
      if (state === "BLIND")
        expect(serialized).not.toMatch(
          /tokenPressurePercent|buyerCount|sellerCount|grossVolumeUsd/,
        );
    }

    const fetchedAt = (
      store.sqlite
        .query("SELECT fetched_at FROM provider_cache ORDER BY rowid")
        .all() as { fetched_at: string }[]
    )
      .map((row) => row.fetched_at)
      .sort();
    const legacyVersion = `nansen-v1-${createHash("sha256")
      .update(
        JSON.stringify({
          requestFingerprints: scenario.provenance!.requestFingerprints,
          fetchedAt,
        }),
      )
      .digest("hex")
      .slice(0, 24)}`;
    expect(scenario.version).not.toBe(legacyVersion);
    const { future, ...legacyInput } = {
      ...scenario,
      version: legacyVersion,
      assumptions: {
        ...scenario.assumptions,
        ruleVersion: "smart-flow-holder-balance-v1",
      },
      evidence: {
        flowUsd: measurement(123),
        balanceChangeTokens: measurement(40),
        concentrationPercent: measurement(20),
      },
    };
    store.db
      .insert(inputs)
      .values({
        version: legacyVersion,
        payload: JSON.stringify(legacyInput),
        ordinal: 1,
      })
      .run();
    store.db
      .insert(outcomes)
      .values({ version: legacyVersion, payload: JSON.stringify(future) })
      .run();

    const repeated = await prepareOne({
      client: nansen,
      store,
      tokenAddress: "So11111111111111111111111111111111111111112",
      asOf: "2026-08-01",
      network: "solana",
    });
    expect(repeated).toEqual(scenario);
    expect(store.scenario(legacyVersion).evidence).toEqual(
      legacyInput.evidence,
    );
    expect(requestedChains).toHaveLength(5);
    expect(
      store.sqlite
        .query("SELECT SUM(reserved_credits) AS credits FROM api_usage")
        .get(),
    ).toEqual({ credits: 37 });
    expect(scenario.provenance?.providerVersion).toContain(
      "smart-dex-normalizer-v1",
    );
    expect(scenario.assumptions.ruleVersion).toBe("smart-dex-accumulation-v1");
  });
});

function dexRow(
  address = "0x1111111111111111111111111111111111111111",
  boughtTokens = 100,
  soldTokens = 20,
  boughtUsd = 200,
  soldUsd = 100,
) {
  return {
    address,
    is_smart_money: true,
    bought_token_volume: boughtTokens,
    sold_token_volume: soldTokens,
    gross_token_volume: boughtTokens + soldTokens,
    bought_volume_usd: boughtUsd,
    sold_volume_usd: soldUsd,
    gross_volume_usd: boughtUsd + soldUsd,
  };
}

function dexPage(data: ReturnType<typeof dexRow>[]) {
  return { data, pagination: { is_last_page: true } };
}

describe("historical DEX wallet boundary", () => {
  it("unions full records and deduplicates EVM casing without losing sold volume", () => {
    const row = dexRow("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    const result = normalizeDex(
      dexPage([
        row,
        { ...row, address: row.address.toUpperCase().replace("0X", "0x") },
      ]),
      dexPage([
        dexRow("0x2222222222222222222222222222222222222222", 40, 80, 50, 200),
      ]),
      "ethereum",
    );
    expect(result.wallets).toEqual([
      { boughtTokens: 100, soldTokens: 20, grossUsd: 300 },
      { boughtTokens: 40, soldTokens: 80, grossUsd: 250 },
    ]);
  });

  it("keeps case-distinct Solana wallets and token direction separate from USD direction", () => {
    const first = dexRow("So11111111111111111111111111111111111111112", 10, 20);
    const second = {
      ...first,
      address: "so11111111111111111111111111111111111111112",
    };
    expect(
      normalizeDex(dexPage([first, second]), dexPage([]), "solana").wallets,
    ).toHaveLength(2);
  });

  it.each([
    ["missing pagination", { data: [dexRow()] }],
    [
      "missing amount",
      dexPage([{ ...dexRow(), sold_token_volume: undefined } as never]),
    ],
    ["wrong smart status", dexPage([{ ...dexRow(), is_smart_money: false }])],
    ["invalid address", dexPage([dexRow("invented-invalid-address")])],
    ["wrong USD side", dexPage([dexRow(undefined, 100, 20, 10, 100)])],
    ["inconsistent gross", dexPage([{ ...dexRow(), gross_token_volume: 1 }])],
    ["negative amount", dexPage([{ ...dexRow(), sold_token_volume: -1 }])],
    ["conflicting duplicate", dexPage([dexRow(), dexRow(undefined, 101)])],
  ])("makes %s unavailable", (_name, raw) => {
    expect(normalizeDex(raw, dexPage([]), "ethereum")).toEqual({
      wallets: null,
      reason: "INVALID_DEX",
    });
  });

  it("rejects cross-side membership and incomplete pages without returning a partial union", () => {
    expect(
      normalizeDex(dexPage([dexRow()]), dexPage([dexRow()]), "ethereum")
        .wallets,
    ).toBeNull();
    expect(
      normalizeDex(
        dexPage([dexRow()]),
        { data: [], pagination: { is_last_page: false } },
        "ethereum",
      ),
    ).toEqual({ wallets: null, reason: "INCOMPLETE_DEX" });
    expect(
      normalizeDex(
        { ...dexPage([dexRow()]), warnings: ["private provider warning"] },
        dexPage([]),
        "ethereum",
      ).wallets,
    ).toBeNull();
    expect(normalizeDex(dexPage([]), dexPage([]), "ethereum").wallets).toEqual(
      [],
    );
  });
});
