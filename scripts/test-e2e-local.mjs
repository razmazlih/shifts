import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

// Reset only the fictional test login buckets between spec files. Production
// authentication remains rate limited, including during normal test:e2e runs.
const databaseUrl = process.env.TEST_DATABASE_URL;
const baseURL = process.env.BASE_URL;
if (!databaseUrl || !baseURL) throw new Error("Set TEST_DATABASE_URL and BASE_URL to isolated local test services.");
const database = new URL(databaseUrl), app = new URL(baseURL);
if (![database, app].every(url => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) || !database.pathname.endsWith("_test"))
  throw new Error("This runner only accepts localhost services and a database ending in _test.");
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const files = process.argv.slice(2);
const specs = files.length ? files : readdirSync("tests/e2e").filter(file => file.endsWith(".spec.ts")).sort().map(file => `tests/e2e/${file}`);
const failed = [];
const results = [];
mkdirSync("output/playwright/reports", { recursive: true });
try {
  for (const spec of specs) {
    await db.loginAttempt.deleteMany();
    const name = path.basename(spec, ".spec.ts");
    const report = path.resolve(`output/playwright/reports/${name}.json`);
    const result = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", spec, "--reporter=list,json", `--output=output/playwright/results/${name}`], {
      stdio: "inherit", env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: report },
    });
    try { results.push({ spec, ...JSON.parse(readFileSync(report, "utf8")).stats }); }
    catch { results.push({ spec, reportMissing: true }); }
    if (result.status !== 0) failed.push(spec);
  }
} finally { await db.$disconnect(); }
writeFileSync("output/playwright/reports/latest-run.json", JSON.stringify({ baseURL, results, failed }, null, 2));
console.log(`Completed ${specs.length} spec files; failed: ${failed.length}${failed.length ? ` (${failed.join(", ")})` : ""}`);
process.exitCode = failed.length ? 1 : 0;
