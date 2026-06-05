#!/usr/bin/env node
/**
 * scripts/migrate.mjs — Migration runner for Sole Supply / Berebaso.
 *
 * Reads supabase/migrations/*.sql sorted by the numeric 000N prefix.
 * Maintains public._migrations(name, applied_at, checksum) tracking table.
 *
 * Usage:
 *   node scripts/migrate.mjs             # apply pending migrations
 *   node scripts/migrate.mjs --check     # report pending + destructive (no apply)
 *   node scripts/migrate.mjs --baseline  # record all files as applied without running
 *
 * Environment:
 *   DATABASE_URL — Supabase direct/session connection string (port 5432, NOT pooler).
 *
 * The connection string is read from env and NEVER printed.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");

// ---------------------------------------------------------------------------
// Destructive pattern detection
// ---------------------------------------------------------------------------

/** Patterns that classify a migration as destructive (case-insensitive). */
const DESTRUCTIVE_PATTERNS = [
  /drop\s+table/i,
  /drop\s+column/i,
  /alter\s+table\s+\S+\s+drop\s+column/i,
  /truncate/i,
  /delete\s+from/i,
];

/**
 * Returns true if the SQL content contains at least one destructive statement.
 * @param {string} sql
 * @returns {boolean}
 */
function isDestructive(sql) {
  return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(sql));
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Returns all *.sql migration files sorted by their 000N numeric prefix.
 * Non-SQL files and subdirectories are skipped.
 * @returns {{ name: string; path: string; sql: string; checksum: string }[]}
 */
function loadMigrationFiles() {
  const entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));

  return entries.map((e) => {
    const filePath = join(MIGRATIONS_DIR, e.name);
    const sql = readFileSync(filePath, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    return { name: e.name, path: filePath, sql, checksum };
  });
}

// ---------------------------------------------------------------------------
// GitHub Actions output helper
// ---------------------------------------------------------------------------

/**
 * Write a key=value output. Appends to $GITHUB_OUTPUT when running in CI;
 * falls back to console.log for local runs.
 * @param {string} key
 * @param {string} value
 */
function setOutput(key, value) {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, `${key}=${value}\n`);
  } else {
    console.log(`[output] ${key}=${value}`);
  }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/** Create the _migrations tracking table if it does not exist. */
async function ensureTrackingTable(client) {
  await client.query(`
    create table if not exists public._migrations (
      name       text primary key,
      applied_at timestamptz not null default now(),
      checksum   text not null
    );
  `);
}

/** Return the set of already-applied migration names. */
async function getApplied(client) {
  const res = await client.query(
    "select name from public._migrations order by name;"
  );
  return new Set(res.rows.map((r) => r.name));
}

// ---------------------------------------------------------------------------
// Mode: --check
// ---------------------------------------------------------------------------

async function runCheck(client, files) {
  await ensureTrackingTable(client);
  const applied = await getApplied(client);

  const pending = files.filter((f) => !applied.has(f.name));
  const hasPending = pending.length > 0;
  const hasDestructive = pending.some((f) => isDestructive(f.sql));

  console.log(`Pending migrations: ${pending.length}`);
  for (const f of pending) {
    const tag = isDestructive(f.sql) ? " [DESTRUCTIVE]" : "";
    console.log(`  - ${f.name}${tag}`);
  }

  // Emit GitHub Actions step outputs (also logged for local visibility)
  setOutput("pending", String(hasPending));
  setOutput("destructive", String(hasDestructive));
}

// ---------------------------------------------------------------------------
// Mode: --baseline
// ---------------------------------------------------------------------------

async function runBaseline(client, files) {
  await ensureTrackingTable(client);
  const applied = await getApplied(client);

  let count = 0;
  for (const f of files) {
    if (applied.has(f.name)) {
      console.log(`[baseline] already recorded: ${f.name}`);
      continue;
    }
    await client.query(
      `insert into public._migrations (name, checksum) values ($1, $2)
       on conflict (name) do nothing;`,
      [f.name, f.checksum]
    );
    console.log(`[baseline] recorded: ${f.name}`);
    count++;
  }
  console.log(`Baseline complete. Recorded ${count} migration(s) as applied.`);
}

// ---------------------------------------------------------------------------
// Mode: apply (default)
// ---------------------------------------------------------------------------

async function runApply(client, files) {
  await ensureTrackingTable(client);
  const applied = await getApplied(client);

  const pending = files.filter((f) => !applied.has(f.name));

  if (pending.length === 0) {
    console.log("No pending migrations. Database is up to date.");
    return;
  }

  console.log(`Applying ${pending.length} migration(s)...`);

  for (const f of pending) {
    console.log(`  Applying: ${f.name}`);
    // Run each migration inside a transaction. The tracking insert
    // is inside the same transaction so partial failures are atomic.
    await client.query("begin;");
    try {
      await client.query(f.sql);
      await client.query(
        `insert into public._migrations (name, checksum) values ($1, $2)
         on conflict (name) do nothing;`,
        [f.name, f.checksum]
      );
      await client.query("commit;");
      console.log(`  Applied:  ${f.name}`);
    } catch (err) {
      await client.query("rollback;");
      console.error(`  FAILED:   ${f.name}`);
      console.error(`  Error:    ${err.message}`);
      process.exit(1);
    }
  }

  console.log("All pending migrations applied successfully.");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--check")
    ? "check"
    : args.includes("--baseline")
    ? "baseline"
    : "apply";

  if (!process.env.DATABASE_URL) {
    console.error(
      "Error: DATABASE_URL environment variable is not set.\n" +
        "Use the Supabase direct connection string (port 5432, not the pooler).\n" +
        "Example: postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
    );
    process.exit(1);
  }

  const files = loadMigrationFiles();
  console.log(
    `Found ${files.length} migration file(s) in supabase/migrations/.`
  );

  const client = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();

    if (mode === "check") {
      await runCheck(client, files);
    } else if (mode === "baseline") {
      await runBaseline(client, files);
    } else {
      await runApply(client, files);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err.message);
  process.exit(1);
});
