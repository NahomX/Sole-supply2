-- Sole Supply schema. Run in the Supabase SQL editor.

create extension if not exists "pgcrypto";

create table if not exists public.shoes (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  title text not null,
  brand text,
  image_url text,
  price_usd numeric(10, 2),
  sizes text,
  notes text,
  status text not null default 'upcoming'
    check (status in ('upcoming', 'available', 'sold')),
  created_at timestamptz not null default now()
);

create index if not exists shoes_created_at_idx
  on public.shoes (created_at desc);

alter table public.shoes enable row level security;

-- Read-only public access. All writes go through the service-role key
-- in our API routes, which bypasses RLS.
drop policy if exists "shoes public read" on public.shoes;
create policy "shoes public read"
  on public.shoes for select
  using (true);
