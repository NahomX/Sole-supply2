-- 0012_price_etb_video — admin-set birr price + hands-on video for shoes.
--
-- Adds:
--   1. shoes.price_etb — admin-set local price in Ethiopian birr (numeric(12,2),
--      nullable, must be > 0 when set). The storefront shows it only when set,
--      and shows a "Contact for price" button otherwise. NOTE: price_usd stays
--      admin-only (server-side redaction in app/page.tsx); price_etb is the
--      only price customers ever see.
--   2. shoes.video_url — public URL of a per-shoe hands-on video (text,
--      nullable). The storefront renders a play tile only when set.
--   3. Storage bucket 'shoe-videos' (public read) for the hands-on videos,
--      plus a SELECT policy on storage.objects scoped to the bucket. Writes
--      are service-role only: NO insert/update policies are created, mirroring
--      the shoes/site_copy "public read, service-role writes" pattern
--      (the service role bypasses RLS).
--
-- Purely additive: new nullable columns, a named CHECK constraint, and a new
-- bucket. The CHECK is seated with the same data-preserving
-- DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT pattern as 0011.
--
-- RLS: shoes already has the "shoes public read" policy, so the new columns
-- are publicly readable by design (both are customer-facing). storage.objects
-- ships with RLS already enabled by Supabase — we only add a bucket-scoped
-- SELECT policy here.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + DROP CONSTRAINT IF EXISTS / ADD
-- CONSTRAINT + INSERT ... ON CONFLICT DO NOTHING + DROP POLICY IF EXISTS.
--
-- Manual-apply note: on hosted Supabase, storage.objects is owned by
-- supabase_storage_admin. If the storage policy statements fail with
-- "must be owner of table objects" when run via scripts/migrate.mjs, apply
-- this file through the Supabase SQL Editor instead — against BOTH staging
-- and prod, per supabase/migrations/README.md.

-- ---------------------------------------------------------------------------
-- shoes.price_etb — admin-set birr price (null = "Contact for price").
-- numeric(12,2): birr magnitudes run ~50x USD, so two more integer digits of
-- headroom than price_usd's numeric(10,2).
-- ---------------------------------------------------------------------------
alter table public.shoes add column if not exists price_etb numeric(12, 2);

alter table public.shoes
  drop constraint if exists shoes_price_etb_check;
alter table public.shoes
  add constraint shoes_price_etb_check
  check (price_etb is null or price_etb > 0);

-- ---------------------------------------------------------------------------
-- shoes.video_url — public URL of the hands-on video (null = no play tile).
-- Plain text like url/image_url; normally points into the 'shoe-videos'
-- bucket below, but any https URL works.
-- ---------------------------------------------------------------------------
alter table public.shoes add column if not exists video_url text;

-- ---------------------------------------------------------------------------
-- 'shoe-videos' storage bucket — public read, service-role-only writes.
-- First storage bucket in this project; created in SQL so staging and prod
-- stay in sync through the normal migration flow.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('shoe-videos', 'shoe-videos', true)
on conflict (id) do nothing;

-- Public read of objects in this bucket. The bucket itself is public (CDN
-- URLs work without auth); the explicit SELECT policy additionally lets the
-- anon/authenticated API list and download via the storage API.
drop policy if exists "shoe-videos public read" on storage.objects;
create policy "shoe-videos public read"
  on storage.objects for select
  using (bucket_id = 'shoe-videos');

-- No insert/update policies: uploads go through supabaseService()
-- (service role bypasses RLS), mirroring the service-role-only write
-- convention used for shoes and site_copy.
