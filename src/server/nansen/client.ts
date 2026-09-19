import { createHash, randomUUID } from "node:crypto";
import type { Store } from "../db";

const ORIGIN = "https://api.nansen.ai";
export const endpoints = {
  prices: { path: "/api/v1/tgm/token-ohlcv", cost: 1 },
  flow: { path: "/api/v1beta1/tgm/historical-token-flow-summary", cost: 5 },
  holders: { path: "/api/v1beta1/tgm/historical-top-holders", cost: 25 },
  screener: { path: "/api/v1beta1/token-screener/historical", cost: 5 },
} as const;
export type EndpointName = keyof typeof endpoints;

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
type ClientOptions = {
  store: Store;
  apiKey: string;
  runId: string;
  maxCredits: number;
  credentialNamespace?: string;
  timeoutMs?: number;
  maxRetries?: number;
  minIntervalMs?: number;
  fetch?: Fetch;
  refresh?: boolean;
};

export class NansenError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function headerNumber(headers: Headers, name: string) {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function credentialNamespace(apiKey: string) {
  return hash(`nansen-credential:${apiKey}`).slice(0, 16);
}

export function createNansenClient(options: ClientOptions) {
  const {
    store,
    apiKey,
    runId,
    maxCredits,
    timeoutMs = 60_000,
    maxRetries = 1,
    minIntervalMs = 1_000,
    refresh = false,
  } = options;
  const requestFetch = options.fetch ?? fetch;
  const namespace =
    options.credentialNamespace ?? credentialNamespace(options.apiKey);
  let dispatchTail = Promise.resolve();
  if (!apiKey) throw new Error("NANSEN_API_KEY is not configured.");
  if (!Number.isFinite(maxCredits) || maxCredits <= 0)
    throw new Error("The effective credit budget must be positive and finite.");
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3)
    throw new Error("NANSEN_MAX_RETRIES must be an integer from 0 to 3.");

  async function pace() {
    const slot = store.sqlite
      .transaction(() => {
        const row = store.sqlite
          .query(
            "SELECT value FROM provider_state WHERE name = 'next_dispatch_at'",
          )
          .get() as { value: string } | null;
        const now = Date.now();
        const claimed = Math.max(now, Number(row?.value ?? 0));
        store.sqlite
          .query(
            "INSERT INTO provider_state(name, value) VALUES ('next_dispatch_at', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
          )
          .run(String(claimed + minIntervalMs));
        return claimed;
      })
      .immediate();
    const wait = slot - Date.now();
    if (wait > 0) await Bun.sleep(wait);
  }

  async function dispatch(url: string, init: RequestInit) {
    const previous = dispatchTail;
    let release!: () => void;
    dispatchTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await pace();
      return await requestFetch(url, init);
    } finally {
      release();
    }
  }

  function reserve(
    endpoint: EndpointName,
    requestHash: string,
    estimated: number,
  ) {
    const id = randomUUID();
    store.sqlite
      .transaction(() => {
        const row = store.sqlite
          .query(
            "SELECT COALESCE(SUM(reserved_credits), 0) AS total FROM api_usage WHERE run_id = ? AND kind = 'request'",
          )
          .get(runId) as { total: number };
        if (row.total + estimated > maxCredits)
          throw new NansenError(
            "BUDGET_EXHAUSTED",
            `Credit reservation would exceed the ${maxCredits}-credit run cap.`,
          );
        store.sqlite
          .query(
            "INSERT INTO api_usage(id, run_id, attempted_at, endpoint, request_hash, kind, status, reserved_credits) VALUES (?, ?, ?, ?, ?, 'request', 'reserved', ?)",
          )
          .run(
            id,
            runId,
            new Date().toISOString(),
            endpoint,
            requestHash,
            estimated,
          );
      })
      .immediate();
    return id;
  }

  async function request(endpoint: EndpointName, body: unknown) {
    const definition = endpoints[endpoint];
    const requestHash = hash(`${definition.path}:${stable(body)}`);
    const schemaVersion = `nansen-${endpoint}-v1`;
    if (!refresh) {
      const cached = store.sqlite
        .query(
          "SELECT id, payload, fetched_at, request_id FROM provider_cache WHERE request_hash = ? AND schema_version = ? AND credential_namespace = ? ORDER BY fetched_at DESC LIMIT 1",
        )
        .get(requestHash, schemaVersion, namespace) as {
        id: string;
        payload: string;
        fetched_at: string;
        request_id: string | null;
      } | null;
      if (cached) {
        store.sqlite
          .query(
            "INSERT INTO api_usage(id, run_id, attempted_at, endpoint, request_hash, kind, status, reserved_credits, request_id) VALUES (?, ?, ?, ?, ?, 'cache_hit', 'complete', 0, ?)",
          )
          .run(
            randomUUID(),
            runId,
            new Date().toISOString(),
            endpoint,
            requestHash,
            cached.request_id,
          );
        return {
          payload: JSON.parse(cached.payload) as unknown,
          fingerprint: requestHash,
          fetchedAt: cached.fetched_at,
          requestId: cached.request_id,
          cached: true,
        };
      }
    }

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const usageId = reserve(endpoint, requestHash, definition.cost);
      let response: Response;
      try {
        response = await dispatch(`${ORIGIN}${definition.path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: apiKey },
          body: stable(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        store.sqlite
          .query("UPDATE api_usage SET status = 'unknown_charge' WHERE id = ?")
          .run(usageId);
        if (attempt < maxRetries) continue;
        throw new NansenError(
          "NETWORK_UNKNOWN_CHARGE",
          "Nansen request failed before a billing result was known; its reservation was retained.",
        );
      }

      const quoted = headerNumber(response.headers, "x-nansen-credits-cost");
      const used = headerNumber(response.headers, "x-nansen-credits-used");
      const requestId = response.headers.get("x-request-id");
      const reserved = used ?? Math.max(quoted ?? 0, definition.cost);
      store.sqlite
        .query(
          "UPDATE api_usage SET status = ?, quoted_credits = ?, used_credits = ?, reserved_credits = ?, request_id = ?, http_status = ? WHERE id = ?",
        )
        .run(
          response.ok ? "complete" : "failed",
          quoted,
          used,
          reserved,
          requestId,
          response.status,
          usageId,
        );

      const responseText = await response.text();
      let payload: unknown;
      try {
        payload = JSON.parse(responseText);
      } catch {
        throw new NansenError(
          "INVALID_JSON",
          `Nansen returned non-JSON data with HTTP ${response.status}.`,
        );
      }
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < maxRetries) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const delay =
            Number.isFinite(retryAfter) && retryAfter >= 0
              ? Math.min(retryAfter * 1000, 30_000)
              : Math.min(500 * 2 ** attempt, 5_000);
          if (delay > 0) await Bun.sleep(delay);
          continue;
        }
        throw new NansenError(
          response.status === 401
            ? "UNAUTHORIZED"
            : response.status === 403
              ? "FORBIDDEN"
              : response.status === 429
                ? "RATE_LIMITED"
                : response.status >= 500
                  ? "UPSTREAM_UNAVAILABLE"
                  : "INVALID_REQUEST",
          `Nansen request failed with HTTP ${response.status}; response body was not logged.`,
        );
      }

      const fetchedAt = new Date().toISOString();
      store.sqlite
        .query(
          "INSERT INTO provider_cache(id, request_hash, endpoint, schema_version, credential_namespace, fetched_at, request_id, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          randomUUID(),
          requestHash,
          endpoint,
          schemaVersion,
          namespace,
          fetchedAt,
          requestId,
          JSON.stringify(payload),
        );
      return {
        payload,
        fingerprint: requestHash,
        fetchedAt,
        requestId,
        cached: false,
      };
    }
    throw new Error("Unreachable Nansen request state.");
  }

  return { request, runId, maxCredits };
}

export type NansenClient = ReturnType<typeof createNansenClient>;
