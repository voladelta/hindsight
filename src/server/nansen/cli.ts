import { randomUUID } from "node:crypto";
import { loadEnvironmentFiles, positiveFinite } from "../env";
import { openStore } from "../db";
import { createNansenClient } from "./client";

export type CliOptions = Record<string, string | boolean>;

export function parseCli(
  args: string[],
  allowedValues: string[],
  allowedFlags: string[],
) {
  const result: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!argument.startsWith("--"))
      throw new Error(`Unknown option: ${argument}`);
    const equal = argument.indexOf("=");
    const name = argument.slice(2, equal === -1 ? undefined : equal);
    if (allowedFlags.includes(name)) {
      if (equal !== -1)
        throw new Error(`Option --${name} does not take a value.`);
      result[name] = true;
      continue;
    }
    if (!allowedValues.includes(name))
      throw new Error(`Unknown option: --${name}`);
    const value = equal === -1 ? args[++index] : argument.slice(equal + 1);
    if (!value || value.startsWith("--"))
      throw new Error(`Option --${name} requires a value.`);
    result[name] = value;
  }
  return result;
}

export function providerContext(options: CliOptions, minimumCredits: number) {
  loadEnvironmentFiles();
  const apiKey = process.env.NANSEN_API_KEY;
  if (!apiKey) throw new Error("NANSEN_API_KEY is not configured.");
  const environmentCap = positiveFinite(
    "NANSEN_MAX_CREDITS",
    process.env.NANSEN_MAX_CREDITS,
  );
  const commandCap = positiveFinite(
    "--max-credits",
    asString(options["max-credits"]),
  );
  const maxCredits = Math.min(environmentCap, commandCap);
  if (maxCredits < minimumCredits)
    throw new Error(
      `The effective budget must be at least ${minimumCredits} credits.`,
    );
  if (numericEnvironment("NANSEN_CONCURRENCY", 1) !== 1)
    throw new Error("NANSEN_CONCURRENCY must remain 1 for provider requests.");

  const store = openStore();
  const runId = asString(options["run-id"]) ?? randomUUID();
  const client = createNansenClient({
    store,
    apiKey,
    runId,
    maxCredits,
    timeoutMs: positiveEnvironment("NANSEN_REQUEST_TIMEOUT_MS", 60_000),
    maxRetries: numericEnvironment("NANSEN_MAX_RETRIES", 1),
    minIntervalMs: positiveEnvironment("NANSEN_MIN_INTERVAL_MS", 1_000),
    refresh: options.refresh === true,
  });
  return { store, client, runId, maxCredits };
}

export function asString(value: string | boolean | undefined) {
  return typeof value === "string" ? value : undefined;
}

function numericEnvironment(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${name} is invalid.`);
  return value;
}

function positiveEnvironment(name: string, fallback: number) {
  const value = numericEnvironment(name, fallback);
  if (value <= 0) throw new Error(`${name} must be positive.`);
  return value;
}
