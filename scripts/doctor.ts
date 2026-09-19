import { existsSync } from "node:fs";
import { loadEnvironmentFiles } from "../src/server/env";

loadEnvironmentFiles();
console.log(`Bun ${Bun.version}; expected 1.4.1.`);
console.log("Mode: cached historical replay powered by Nansen API.");
console.log(
  `Production assets: ${existsSync("dist/index.html") ? "ready" : "run bun run build"}.`,
);
console.log(
  "No provider request was made. Run bun run setup to prepare local storage.",
);
