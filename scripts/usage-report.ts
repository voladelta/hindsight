import { loadEnvironmentFiles } from "../src/server/env";
import { openStore } from "../src/server/db";
import { asString, parseCli } from "../src/server/nansen/cli";
import { auditCorpus } from "../src/server/nansen/preparation";

loadEnvironmentFiles();
const options = parseCli(process.argv.slice(2), ["run-id"], []);
const runId = asString(options["run-id"]);
const store = openStore();
try {
  const where = runId ? " WHERE run_id = ?" : "";
  const args = runId ? [runId] : [];
  const rows = store.sqlite
    .query(
      `SELECT kind, status, COUNT(*) AS attempts, COALESCE(SUM(reserved_credits), 0) AS reserved, SUM(quoted_credits) AS quoted, SUM(used_credits) AS used FROM api_usage${where} GROUP BY kind, status ORDER BY kind, status`,
    )
    .all(...args);
  console.log(
    JSON.stringify(
      { runId: runId ?? "all", usage: rows, corpus: auditCorpus(store, runId) },
      null,
      2,
    ),
  );
  console.log(
    "Null quoted/used totals mean provider billing headers were unavailable; retained reservations remain conservative estimates.",
  );
} finally {
  store.sqlite.close();
}
