# Migrations

Numbered SQL files applied in order. Each migration must be **idempotent** —
re-running a migration against a database that already has it must be a no-op.
Until we adopt the Supabase CLI's migration tracking, idempotency is the
discipline that lets us safely re-run any subset.

## Naming

`NNNN_short_description.sql`, four-digit zero-padded number.

- `0001_init.sql` — initial baseline (shoes, profiles, interests, RLS, signup trigger)

Pick the next available number. Don't renumber existing files.

## Writing a migration

- Use `if not exists` / `if exists` on every DDL statement.
- For policies and triggers: `drop ... if exists` then `create`.
- For functions: `create or replace function`.
- Avoid `drop table` or destructive changes without a deprecation window. If
  unavoidable, write the migration in two stages across releases.
- Don't depend on data — schema only. Backfills go in their own numbered
  migration with a comment explaining safety (run-once vs. re-runnable).

## Applying

For now, manually:

1. Open the Supabase SQL Editor for the target project (staging or prod).
2. Paste each new migration in order.
3. Run.

Future: `supabase db push` once we adopt the Supabase CLI.

## Two databases

Run every migration against **both** the staging Supabase project and the
production project. Staging first, verify, then prod. They must stay in sync.
