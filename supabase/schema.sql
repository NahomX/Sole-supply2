-- Sole Supply schema. Run in the Supabase SQL editor.
-- Idempotent: safe to re-run after the dev-branch auth migration.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- shoes
-- ---------------------------------------------------------------------------
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

drop policy if exists "shoes public read" on public.shoes;
create policy "shoes public read"
  on public.shoes for select
  using (true);

-- ---------------------------------------------------------------------------
-- profiles — one row per auth.users user, carries the role
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'customer'
    check (role in ('admin', 'submitter', 'customer')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read"
  on public.profiles for select
  using (auth.uid() = id);

-- Admins can read all profiles. We check via a recursive-safe function
-- (direct policy against profiles would loop).
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = uid and role = 'admin'
  );
$$;

drop policy if exists "profiles admin read all" on public.profiles;
create policy "profiles admin read all"
  on public.profiles for select
  using (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- Trigger: create profile on signup, promote admin emails automatically.
-- ADMIN_EMAILS is stored as a comma-separated string in a postgres setting
-- so the trigger doesn't need to read env vars. We set it via SQL in the
-- Supabase dashboard: `alter database postgres set app.admin_emails = '...';`
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_emails text := current_setting('app.admin_emails', true);
  invited_role text := new.raw_user_meta_data->>'role';
  final_role text := 'customer';
begin
  if admin_emails is not null
     and position(lower(new.email) in lower(admin_emails)) > 0 then
    final_role := 'admin';
  elsif invited_role in ('admin', 'submitter', 'customer') then
    final_role := invited_role;
  end if;

  insert into public.profiles (id, email, role)
  values (new.id, new.email, final_role)
  on conflict (id) do update set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- interests — "I want this" from signed-in customers
-- ---------------------------------------------------------------------------
create table if not exists public.interests (
  id uuid primary key default gen_random_uuid(),
  shoe_id uuid not null references public.shoes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  size text,
  notes text,
  created_at timestamptz not null default now(),
  unique (shoe_id, user_id)
);

create index if not exists interests_shoe_idx on public.interests (shoe_id);
create index if not exists interests_user_idx on public.interests (user_id);

alter table public.interests enable row level security;

drop policy if exists "interests self read" on public.interests;
create policy "interests self read"
  on public.interests for select
  using (auth.uid() = user_id);

drop policy if exists "interests admin read all" on public.interests;
create policy "interests admin read all"
  on public.interests for select
  using (public.is_admin(auth.uid()));

drop policy if exists "interests self insert" on public.interests;
create policy "interests self insert"
  on public.interests for insert
  with check (auth.uid() = user_id);

drop policy if exists "interests self delete" on public.interests;
create policy "interests self delete"
  on public.interests for delete
  using (auth.uid() = user_id);
