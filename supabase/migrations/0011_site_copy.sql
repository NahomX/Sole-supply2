-- 0011_site_copy — Telegram-editable website copy + soft-remove for shoes.
--
-- Adds:
--   1. site_copy — key/value store for storefront strings (hero tagline,
--      section titles, footer). Bilingual: value_en + value_am. The site reads
--      these via lib/site-copy.ts and falls back to hardcoded DEFAULTS if a key
--      is missing, so the storefront renders identically until an edit is made.
--   2. shoes.removed_at — soft-remove marker. Customer storefront queries filter
--      `removed_at is null`; the row is never deleted (audit trail preserved).
--   3. Extends the shoe_events event_type CHECK to allow 'shoe_edit' and
--      'shoe_removed' so field edits and soft-removes are auditable.
--
-- ALL additive: no DROP TABLE / DROP COLUMN / TRUNCATE / DELETE. The CHECK
-- swap below only DROP CONSTRAINT + ADD CONSTRAINT (data-preserving).
--
-- RLS: site_copy ENABLED with public read (storefront reads at request time);
-- writes are service-role only (mirrors the shoes public-read pattern).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING +
-- ADD COLUMN IF NOT EXISTS.

-- ---------------------------------------------------------------------------
-- site_copy — editable storefront strings, keyed by a stable string key.
-- ---------------------------------------------------------------------------
create table if not exists public.site_copy (
  key text primary key,
  value_en text,
  value_am text,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.site_copy enable row level security;

drop policy if exists "site_copy public read" on public.site_copy;
create policy "site_copy public read"
  on public.site_copy for select
  using (true);

-- Seed the strings currently hardcoded in app/page.tsx and app/layout.tsx.
-- ON CONFLICT DO NOTHING so re-running never clobbers a later Telegram edit.
insert into public.site_copy (key, value_en, value_am) values
  ('hero_tagline', 'Fresh sneakers from the US, straight to Addis.', 'ከአሜሪካ የመጡ አዳዲስ ጫማዎች፣ በቀጥታ ወደ አዲስ አበባ'),
  ('section_available', 'Available now', 'አሁን ዝግጁ'),
  ('section_on_the_way', 'On the way', 'በመንገድ ላይ'),
  ('section_coming_soon', 'Coming soon', 'በቅርቡ ይመጣል'),
  ('section_previously', 'Previously', 'ቀደም ሲል የነበሩ'),
  ('footer', 'Addis Ababa, Ethiopia', null)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- shoes.removed_at — soft-remove marker (non-null = hidden from storefront).
-- ---------------------------------------------------------------------------
alter table public.shoes add column if not exists removed_at timestamptz;

-- ---------------------------------------------------------------------------
-- shoe_events.event_type — extend the CHECK to allow edit + remove events.
-- 0001/0010 created the inline check constraint as shoe_events_event_type_check
-- (Postgres default name for a column-level `check (event_type in (...))`).
-- DROP + re-ADD is data-preserving (not in the destructive-gated set).
-- ---------------------------------------------------------------------------
alter table public.shoe_events
  drop constraint if exists shoe_events_event_type_check;
alter table public.shoe_events
  add constraint shoe_events_event_type_check
  check (event_type in (
    'shoe_created',
    'sales_status_change',
    'logistics_status_change',
    'shoe_edit',
    'shoe_removed'
  ));
