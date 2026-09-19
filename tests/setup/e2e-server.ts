import { unlinkSync } from "node:fs";
import { openStore } from "../../src/server/db";
import { seedFixtureScenarios } from "../fixtures/scenario";

const databasePath = process.env.DATABASE_PATH;
if (databasePath !== ".data/hindsight-e2e.sqlite") {
  throw new Error("E2E server requires its dedicated test database path.");
}

for (const path of [
  databasePath,
  `${databasePath}-shm`,
  `${databasePath}-wal`,
]) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
  }
}

const store = openStore(databasePath);
seedFixtureScenarios(store);
store.sqlite.close();

await import("../../src/server/main");
