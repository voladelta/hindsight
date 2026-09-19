import { afterEach, describe, expect, it } from "vitest";
import { openStore, type Store } from "../../src/server/db";
import {
  createNansenClient,
  NansenError,
} from "../../src/server/nansen/client";
import {
  normalizeHolders,
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
    let requestBody: unknown;
    const nansen = client(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "x-nansen-credits-used": "5" },
      });
    }, 5);

    await fetchUniverse(nansen, "2026-08-01", "solana");

    expect(requestBody).toMatchObject({ chains: ["solana"] });
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
      maxCredits: 32,
      maxRetries: 0,
      minIntervalMs: 0,
      fetch: async (input, init) => {
        const url = String(input);
        const requestBody = JSON.parse(String(init?.body)) as {
          chain: string;
          date?: { from: string };
        };
        requestedChains.push(requestBody.chain);
        if (url.includes("historical-token-flow-summary"))
          return new Response(
            JSON.stringify({ data: [{ smart_trader_net_flow_usd: 10 }] }),
          );
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
    expect(requestedChains).toEqual(["solana", "solana", "solana", "solana"]);
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
  });
});
