import { openStore } from "../src/server/db";
import { loadEnvironmentFiles } from "../src/server/env";

loadEnvironmentFiles();
const store = openStore();
store.sqlite.close();
console.log(
  "Local database migrated. Existing records and environment files preserved. No network requests. Prepare Nansen-backed scenarios before playing.",
);
