-- 0004_telegram_users — Telegram bot allowlist.
--
-- Maps a Telegram numeric user ID to a role and an optional list of bot names
-- the person is allowed to use. The bots verify membership in this table before
-- performing any write operation. The customer bot does NOT check this table —
-- it is public-read-only.
--
-- Idempotent: safe to re-run on a database that already has the table.

create table if not exists public.telegram_users (
  telegram_id   bigint       primary key,
  role          text         not null check (role in ('admin', 'shipper')),
  label         text,                                  -- friendly name for the owner's reference
  allowed_bots  text[]       null,                     -- null = all bots for the role; set = restrict
  created_at    timestamptz  not null default now()
);

-- RLS: only the service role reads/writes this table.
-- No anon or authenticated policies — all bot reads go through the service-role client.
alter table public.telegram_users enable row level security;

-- Drop any existing policy so the migration is idempotent.
drop policy if exists "telegram_users service only" on public.telegram_users;
-- No policies needed — service-role bypasses RLS. Authenticated users have no
-- legitimate reason to read or write the Telegram allowlist via the public API.
