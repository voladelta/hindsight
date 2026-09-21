import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scenarioSchema } from "../../src/domain/model";
import { evaluateRule } from "../../src/domain/engine";
import { createApi } from "../../src/server/api";
import {
  inputs,
  openStore,
  outcomes,
  rounds,
  type Store,
} from "../../src/server/db";
import { fixtureScenario, seedFixtureScenarios } from "../fixtures/scenario";

const origin = "http://hindsight.test";
process.env.DEPLOYMENT_MODE = "local";

let store: Store;
let api: ReturnType<typeof createApi>;

function request(
  path: string,
  options: {
    method?: "GET" | "POST";
    cookie?: string;
    key?: string;
    body?: unknown;
    origin?: string;
  } = {},
) {
  const method = options.method ?? "GET";
  const headers = new Headers();
  if (options.cookie) headers.set("Cookie", options.cookie);

  if (method === "POST") {
    headers.set("Content-Type", "application/json");
    headers.set("Origin", options.origin ?? origin);
    headers.set("Idempotency-Key", options.key ?? crypto.randomUUID());
  }

  return api(
    new Request(`${origin}${path}`, {
      method,
      headers,
      ...(method === "POST"
        ? { body: JSON.stringify(options.body ?? {}) }
        : {}),
    }),
  );
}

async function session() {
  const response = await request("/api/session");
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("Session cookie was not created");

  return cookie;
}

async function createRound(
  cookie: string,
  key = crypto.randomUUID(),
  chain: "ethereum" | "solana" = "ethereum",
) {
  const response = await request("/api/rounds", {
    method: "POST",
    cookie,
    key,
    body: { duration: "INTRADAY", chain },
  });
  return {
    response,
    body: (await response.json()) as { id: string; state: string },
  };
}

beforeEach(() => {
  store = openStore(":memory:");
  seedFixtureScenarios(store);
  api = createApi(store, origin);
});

afterEach(() => {
  store.sqlite.close();
});

describe("round API state and privacy", () => {
  it("publishes friendly replay-pool availability without token identities", async () => {
    const response = await request("/api/session");
    const body = (await response.json()) as {
      replayNetworks: Array<{
        value: string;
        available: boolean;
        unavailableReason: string | null;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty("mode");
    expect(body.replayNetworks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "ethereum", available: true }),
        expect.objectContaining({ value: "solana", available: true }),
      ]),
    );
    expect(body.replayNetworks).toHaveLength(2);
    expect(JSON.stringify(body)).not.toMatch(/Test Fern|TST1|token_address/);
  });

  it("excludes legacy-rule fixtures from new round counts and selection", async () => {
    const modern = fixtureScenario(0, "INTRADAY", "solana");
    const legacyEvidence = {
      flowUsd: { status: "available" as const, value: 25000 },
      concentrationPercent: { status: "available" as const, value: 40 },
      balanceChangeTokens: { status: "available" as const, value: 5000 },
    };
    const legacy = scenarioSchema.parse({
      ...modern,
      version: "test-legacy-intraday-solana",
      identity: {
        name: "Legacy Signal",
        symbol: "OLD",
        chain: "Solana",
      },
      evidence: legacyEvidence,
      opponent: evaluateRule(legacyEvidence),
      assumptions: {
        ...modern.assumptions,
        ruleVersion: "smart-flow-holder-balance-v1",
      },
    });
    const { future, ...input } = legacy;
    store.db
      .insert(inputs)
      .values({
        version: legacy.version,
        payload: JSON.stringify(input),
        ordinal: -1,
      })
      .run();
    store.db
      .insert(outcomes)
      .values({ version: legacy.version, payload: JSON.stringify(future) })
      .run();

    const sessionResponse = await request("/api/session");
    const sessionBody = (await sessionResponse.json()) as {
      replayNetworks: Array<{
        value: string;
        preparedCounts: { intraday: number };
      }>;
    };
    expect(
      sessionBody.replayNetworks.find((network) => network.value === "solana")
        ?.preparedCounts.intraday,
    ).toBe(6);

    const cookie = sessionResponse.headers.get("set-cookie")?.split(";", 1)[0];
    if (!cookie) throw new Error("Session cookie was not created");
    const created = await createRound(cookie, crypto.randomUUID(), "solana");
    const storedRound = store.sqlite
      .query("SELECT version FROM rounds WHERE id = ?")
      .get(created.body.id) as { version: string };

    expect(created.response.status).toBe(200);
    expect(storedRound.version).not.toBe(legacy.version);

    const legacyRoundId = crypto.randomUUID();
    const token = cookie.split("=", 2)[1]!;
    store.db
      .insert(rounds)
      .values({
        id: legacyRoundId,
        owner: createHash("sha256").update(token).digest("hex"),
        version: legacy.version,
        payload: JSON.stringify({ id: legacyRoundId, state: "BLIND" }),
      })
      .run();

    const restoredLegacy = await request(`/api/rounds/${legacyRoundId}`, {
      cookie,
    });
    expect(restoredLegacy.status).toBe(200);
    expect((await restoredLegacy.json()).state).toBe("BLIND");
  });

  it("reports an unavailable pool instead of inventing a fallback replay", async () => {
    const emptyStore = openStore(":memory:");
    const emptyApi = createApi(emptyStore, origin);
    const sessionResponse = await emptyApi(
      new Request(`${origin}/api/session`),
    );
    const cookie = sessionResponse.headers.get("set-cookie")?.split(";", 1)[0];
    const response = await emptyApi(
      new Request(`${origin}/api/rounds`, {
        method: "POST",
        headers: {
          Cookie: cookie ?? "",
          Origin: origin,
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ duration: "INTRADAY" }),
      }),
    );
    emptyStore.sqlite.close();

    expect(response.status).toBe(503);
    expect(await response.text()).toContain("No historical replays");
  });

  it("progresses through explicit stage responses without early disclosure", async () => {
    const cookie = await session();
    const created = await createRound(cookie);

    expect(created.response.status).toBe(200);
    expect(JSON.stringify(created.body)).not.toMatch(
      /Test Fern|TST1|2026-08-02|evidence|opponent|outcome/,
    );

    const initial = await request(`/api/rounds/${created.body.id}/initial`, {
      method: "POST",
      cookie,
      body: { choice: "BUY" },
    });
    const evidence = (await initial.json()) as Record<string, unknown>;
    expect(initial.status).toBe(200);
    expect(evidence.state).toBe("EVIDENCE");
    expect(evidence).toHaveProperty("evidence");
    expect(evidence).not.toHaveProperty("opponent");
    expect(evidence).not.toHaveProperty("outcome");

    const earlyReveal = await request(`/api/rounds/${created.body.id}/reveal`, {
      method: "POST",
      cookie,
    });
    expect(earlyReveal.status).toBe(409);

    const final = await request(`/api/rounds/${created.body.id}/final`, {
      method: "POST",
      cookie,
      body: { choice: "CASH" },
    });
    const locked = (await final.json()) as Record<string, unknown>;
    expect(locked.state).toBe("LOCKED");
    expect(locked).toHaveProperty("opponent");
    expect(locked).not.toHaveProperty("outcome");

    const reveal = await request(`/api/rounds/${created.body.id}/reveal`, {
      method: "POST",
      cookie,
    });
    const revealed = (await reveal.json()) as Record<string, unknown>;
    expect(revealed.state).toBe("REVEALED");
    expect(revealed).toHaveProperty("identity");
    expect(revealed).toHaveProperty("outcome");

    const restored = await request(`/api/rounds/${created.body.id}`, {
      cookie,
    });
    expect(((await restored.json()) as { state: string }).state).toBe(
      "REVEALED",
    );
  });

  it("creates immutable intraday and seven-day round variants", async () => {
    const cookie = await session();
    const intraday = await createRound(cookie);
    const sevenDayResponse = await request("/api/rounds", {
      method: "POST",
      cookie,
      body: { duration: "SEVEN_DAYS" },
    });
    const sevenDay = (await sevenDayResponse.json()) as {
      chart: { unit: string; points: unknown[] };
      assumptions: Record<string, unknown>;
    };

    expect(intraday.body).toMatchObject({ state: "BLIND" });
    expect(sevenDayResponse.status).toBe(200);
    expect(sevenDay.chart.unit).toBe("day");
    expect(sevenDay.chart.points).toHaveLength(30);
    expect(sevenDay.assumptions).toMatchObject({ holdingDays: 7 });
  });

  it("uses the selected supported network without disclosing it before reveal", async () => {
    const cookie = await session();
    const created = await createRound(cookie, crypto.randomUUID(), "solana");

    expect(created.response.status).toBe(200);
    expect(JSON.stringify(created.body)).not.toMatch(/Solana|Test Fern|TST1/);

    await request(`/api/rounds/${created.body.id}/initial`, {
      method: "POST",
      cookie,
      body: { choice: "BUY" },
    });
    await request(`/api/rounds/${created.body.id}/final`, {
      method: "POST",
      cookie,
      body: { choice: "BUY" },
    });
    const reveal = await request(`/api/rounds/${created.body.id}/reveal`, {
      method: "POST",
      cookie,
    });
    const body = (await reveal.json()) as {
      identity: { chain: string };
    };

    expect(body.identity.chain).toBe("Solana");
  });

  it("rejects unsupported networks that are absent from the picker", async () => {
    const cookie = await session();
    const response = await request("/api/rounds", {
      method: "POST",
      cookie,
      body: { duration: "INTRADAY", chain: "robinhood" },
    });

    expect(response.status).toBe(400);
  });

  it("rejects an unsupported duration instead of choosing a fallback", async () => {
    const cookie = await session();
    const response = await request("/api/rounds", {
      method: "POST",
      cookie,
      body: { duration: "THIRTY_DAYS" },
    });

    expect(response.status).toBe(400);
  });

  it("scopes reads and writes to the owning session", async () => {
    const ownerCookie = await session();
    const otherCookie = await session();
    const { body } = await createRound(ownerCookie);

    expect(
      (await request(`/api/rounds/${body.id}`, { cookie: otherCookie })).status,
    ).toBe(404);
    expect(
      (
        await request(`/api/rounds/${body.id}/initial`, {
          method: "POST",
          cookie: otherCookie,
          body: { choice: "BUY" },
        })
      ).status,
    ).toBe(404);
  });

  it("rejects cross-origin mutations", async () => {
    const cookie = await session();
    const response = await request("/api/rounds", {
      method: "POST",
      cookie,
      origin: "https://attacker.invalid",
    });

    expect(response.status).toBe(403);
  });
});

describe("idempotency and concurrency", () => {
  it("replays an identical request and rejects reuse for different input", async () => {
    const cookie = await session();
    const { body } = await createRound(cookie);
    const key = crypto.randomUUID();

    const first = await request(`/api/rounds/${body.id}/initial`, {
      method: "POST",
      cookie,
      key,
      body: { choice: "BUY" },
    });
    const replay = await request(`/api/rounds/${body.id}/initial`, {
      method: "POST",
      cookie,
      key,
      body: { choice: "BUY" },
    });
    const conflict = await request(`/api/rounds/${body.id}/initial`, {
      method: "POST",
      cookie,
      key,
      body: { choice: "CASH" },
    });

    expect(await replay.text()).toBe(await first.text());
    expect(conflict.status).toBe(409);
  });

  it("allows only one concurrent final choice to mutate the round", async () => {
    const cookie = await session();
    const { body } = await createRound(cookie);
    await request(`/api/rounds/${body.id}/initial`, {
      method: "POST",
      cookie,
      body: { choice: "BUY" },
    });

    const responses = await Promise.all([
      request(`/api/rounds/${body.id}/final`, {
        method: "POST",
        cookie,
        body: { choice: "BUY" },
      }),
      request(`/api/rounds/${body.id}/final`, {
        method: "POST",
        cookie,
        body: { choice: "CASH" },
      }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
  });
});
