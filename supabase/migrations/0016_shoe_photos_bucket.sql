-- 0016_shoe_photos_bucket — public-read storage bucket for product photos.
--
-- Adds:
--   1. Storage bucket 'shoe-photos' (public read) for per-shoe product photos
--      uploaded via the Telegram bot. Clones the pattern from migration 0012
--      (shoe-videos): PUBLIC bucket with an explicit SELECT policy on
--      storage.objects, no insert/update policies (writes go through
--      supabaseService() which bypasses RLS via the service role).
--
-- The uploaded photos are used as display images on the storefront, replacing
-- the auto-scraped retailer white-background images. When a "hero" view type
-- is uploaded, shoes.image_url is also updated so the photo becomes the
-- primary card image everywhere.
--
-- Purely additive: one new bucket + one RLS policy on storage.objects.
-- Does NOT modify any existing tables or columns.
--
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING + DROP POLICY IF EXISTS.
--
-- Manual-apply note: on hosted Supabase, storage.objects is owned by
-- supabase_storage_admin. If the storage policy statements fail with
-- "must be owner of table objects" when run via scripts/migrate.mjs, apply
-- this file through the Supabase SQL Editor instead — against BOTH staging
-- and prod, per supabase/migrations/README.md.

-- ---------------------------------------------------------------------------
-- 'shoe-photos' storage bucket — public read, service-role-only writes.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('shoe-photos', 'shoe-photos', true)
on conflict (id) do nothing;

-- Public read of objects in this bucket. The bucket itself is public (CDN
-- URLs work without auth); the explicit SELECT policy additionally lets the
-- anon/authenticated API list and download via the storage API.
drop policy if exists "shoe-photos public read" on storage.objects;
create policy "shoe-photos public read"
  on storage.objects for select
  using (bucket_id = 'shoe-photos');

-- No insert/update policies: uploads go through supabaseService()
-- (service role bypasses RLS), mirroring the shoe-videos convention.
