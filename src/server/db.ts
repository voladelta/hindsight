import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { eq } from "drizzle-orm";
import { scenarioSchema } from "../domain/model";

export const inputs = sqliteTable("scenario_inputs", {
  version: text().primaryKey(),
  payload: text().notNull(),
  ordinal: integer().notNull(),
});
export const outcomes = sqliteTable("scenario_outcomes", {
  version: text()
    .primaryKey()
    .references(() => inputs.version),
  payload: text().notNull(),
});
export const rounds = sqliteTable("rounds", {
  id: text().primaryKey(),
  owner: text().notNull(),
  version: text()
    .notNull()
    .references(() => inputs.version),
  payload: text().notNull(),
});
export const requests = sqliteTable("idempotency", {
  id: text().primaryKey(),
  hash: text().notNull(),
  response: text().notNull(),
});
export const sessions = sqliteTable("sessions", {
  owner: text().primaryKey(),
  expires: integer().notNull(),
});

export function openStore(
  path = process.env.DATABASE_PATH ?? ".data/hindsight.sqlite",
) {
  if (path !== ":memory:")
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const sqlite = new Database(path, { create: true, strict: true });
  sqlite.exec(
    "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
  );
  // Versioned, additive migration. Repeated setup never deletes or rewrites data.
  sqlite
    .transaction(() => {
      sqlite.exec(`
      CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS scenario_inputs (version TEXT PRIMARY KEY, payload TEXT NOT NULL, ordinal INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS scenario_outcomes (version TEXT PRIMARY KEY REFERENCES scenario_inputs(version), payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rounds (id TEXT PRIMARY KEY, owner TEXT NOT NULL, version TEXT NOT NULL REFERENCES scenario_inputs(version), payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS rounds_owner ON rounds(owner);
      CREATE TABLE IF NOT EXISTS idempotency (id TEXT PRIMARY KEY, hash TEXT NOT NULL, response TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (owner TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      INSERT OR IGNORE INTO migrations(version) VALUES (1);
      CREATE TABLE IF NOT EXISTS provider_cache (
        id TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        credential_namespace TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        request_id TEXT,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS provider_cache_lookup ON provider_cache(request_hash, schema_version, credential_namespace, fetched_at);
      CREATE TABLE IF NOT EXISTS api_usage (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        attempted_at TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        quoted_credits REAL,
        used_credits REAL,
        reserved_credits REAL NOT NULL,
        request_id TEXT,
        http_status INTEGER
      );
      CREATE INDEX IF NOT EXISTS api_usage_run ON api_usage(run_id);
      CREATE TABLE IF NOT EXISTS provider_state (
        name TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scenario_candidates (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        token_address TEXT NOT NULL,
        token_name TEXT NOT NULL,
        token_symbol TEXT NOT NULL,
        as_of_date TEXT NOT NULL,
        config_version TEXT NOT NULL,
        seed TEXT NOT NULL,
        status TEXT NOT NULL,
        scenario_version TEXT,
        error_code TEXT,
        UNIQUE(run_id, token_address, as_of_date)
      );
      CREATE INDEX IF NOT EXISTS scenario_candidates_run ON scenario_candidates(run_id, ordinal);
      INSERT OR IGNORE INTO migrations(version) VALUES (2);
    `);
    })
    .immediate();
  const db = drizzle(sqlite);
  function scenario(version: string) {
    const input = db
      .select()
      .from(inputs)
      .where(eq(inputs.version, version))
      .get();
    const outcome = db
      .select()
      .from(outcomes)
      .where(eq(outcomes.version, version))
      .get();
    if (!input || !outcome) throw new Error("Missing scenario version");
    return scenarioSchema.parse({
      ...JSON.parse(input.payload),
      future: JSON.parse(outcome.payload),
    });
  }
  return { db, sqlite, scenario };
}
export type Store = ReturnType<typeof openStore>;
