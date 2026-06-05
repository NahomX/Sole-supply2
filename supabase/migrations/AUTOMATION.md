# Migration Automation

This document explains the CI pipeline that automatically applies
`supabase/migrations/*.sql` when new files land on `main`, with a manual
approval gate for destructive operations.

---

## How it works

Every push to `main` that touches `supabase/migrations/**` triggers
`.github/workflows/migrate.yml`. Three jobs run:

### Job 1 — `detect`

Runs `node scripts/migrate.mjs --check`. Queries the `public._migrations`
tracking table and compares it against files on disk. Emits two step outputs:

- `pending` — `true` if any migration file has not yet been applied.
- `destructive` — `true` if any pending file contains a destructive statement
  (`DROP TABLE`, `DROP COLUMN`, `ALTER TABLE … DROP COLUMN`, `TRUNCATE`,
  `DELETE FROM`).

### Job 2 — `migrate-auto`

Runs only when `pending=true` AND `destructive=false`. Applies every pending
migration automatically, no human approval needed. Additive migrations (new
tables, new columns, new policies, new functions) follow this path.

### Job 3 — `migrate-gated`

Runs only when `pending=true` AND `destructive=true`. Uses `environment:
production` — GitHub pauses the job and sends an approval request to the
required reviewers you configure (see below). After approval, migrations run.
After rejection, the job fails and no SQL runs.

---

## Required setup (one-time, you must do this)

### 1. Set the `DATABASE_URL` GitHub secret

Use the Supabase **direct / session** connection string on **port 5432** —
NOT the transaction pooler (which uses port 6543 and does not support
multi-statement transactions).

Where to find it:

1. Open your Supabase project dashboard.
2. Go to **Settings → Database**.
3. Under "Connection string" choose **URI** and select the
   **Session mode** tab (port 5432).
4. Copy the full connection string:
   `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`
   (or the direct host `db.<ref>.supabase.co:5432` for non-pooler).

Add it to GitHub:

1. Go to your repo on GitHub → **Settings → Secrets and variables → Actions**.
2. Click **New repository secret**.
3. Name: `DATABASE_URL`
4. Value: the connection string from above.
5. Save.

The secret is only available to GitHub Actions — the agent running in Claude
never has access to it.

### 2. Configure the `production` GitHub Environment with required reviewers

The `migrate-gated` job uses `environment: production`. To make it require
manual approval:

1. Go to your repo on GitHub → **Settings → Environments**.
2. Click **New environment** and name it `production` (must match exactly).
3. Under **Deployment protection rules**, enable **Required reviewers**.
4. Add yourself (and any other admins) as required reviewers.
5. Save the environment.

Once configured, any time a destructive migration lands on `main`, GitHub
will pause the workflow and send a notification. A reviewer must click
**Approve and deploy** before the SQL runs. Clicking **Reject** cancels the
job and no changes are made to the database.

### 3. Run `--baseline` once (IMPORTANT — do this before any CI-triggered run)

Migrations 0001 through 0009 were applied manually via the Supabase SQL Editor.
The `_migrations` tracking table does not exist yet. If you push a new migration
without baselining first, CI will try to re-run all existing files and fail
(they already exist in the DB).

Run the one-time baseline from a machine with the `DATABASE_URL` set:

```bash
# Export the connection string
export DATABASE_URL="postgresql://postgres.<ref>:<password>@db.<ref>.supabase.co:5432/postgres"

# Install pg (if not already in node_modules)
npm ci

# Baseline: records all existing *.sql files as applied without running them
npm run migrate:baseline
```

What this does:
- Creates `public._migrations` if it does not exist.
- Inserts a row for every `.sql` file currently in `supabase/migrations/`
  without executing any SQL.
- Future CI runs will only apply files added after this point.

---

## Migration tracking table

The runner automatically creates this table on first use:

```sql
create table if not exists public._migrations (
  name       text primary key,
  applied_at timestamptz not null default now(),
  checksum   text not null
);
```

Each applied migration file is recorded by filename and SHA-256 checksum of
its content.

---

## Runner script reference (`scripts/migrate.mjs`)

```
node scripts/migrate.mjs              # apply all pending migrations
node scripts/migrate.mjs --check      # report pending + destructive (no apply)
node scripts/migrate.mjs --baseline   # record all files as applied without running
```

npm script aliases:
```
npm run migrate           # apply
npm run migrate:check     # check
npm run migrate:baseline  # baseline
```

---

## Who writes migrations vs. who applies them

- The **agent (PM)** writes new `.sql` files in `supabase/migrations/` and
  includes them in PRs, just as before.
- The agent reviews the SQL logic but does NOT apply migrations — it has no
  standing access to the production database.
- **CI applies migrations** automatically (additive) or after approval
  (destructive) when the PR merges to `main`.
- The `DATABASE_URL` secret lives only in GitHub Actions.

---

## Connection string note

Always use the direct/session connection string (port 5432). The transaction
pooler (port 6543) does not support `BEGIN`/`COMMIT` across the connection
lifecycle used by the runner, and DDL inside a transaction can behave
unexpectedly over a pooled connection.
