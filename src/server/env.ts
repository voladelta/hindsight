import { existsSync, readFileSync } from "node:fs";

export function loadEnvironmentFiles(paths = [".env", ".env.local"]) {
  for (const path of paths) loadEnvironmentFile(path);

  if (!process.env.NANSEN_API_KEY && process.env.NANSEN_API) {
    process.env.NANSEN_API_KEY = process.env.NANSEN_API;
  }
}

function loadEnvironmentFile(path: string) {
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator < 1) throw new Error(`Invalid environment line in ${path}.`);

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

export function positiveFinite(name: string, raw: string | undefined) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be a positive finite number.`);
  return value;
}
