-- 0002_logistics — adds the "shipper" role and a per-shoe logistics_status.
--
-- Logistics flow runs alongside (not in place of) the existing sales status:
--   sales status:     upcoming → available → sold      (admin-managed)
--   logistics status: purchased → dispatched → arrived → delivered  (admin OR shipper-managed)
--
-- Idempotent: re-running on a database that already has these columns/role
-- is a no-op. Check constraints are reseated so the migration can run on
-- top of an older state where the constraint listed only the original roles.

-- ---------------------------------------------------------------------------
-- Role: add 'shipper'.
-- The original 0001 migration created the role check constraint inline,
-- which postgres named auto-generatedly. Drop any check constraint that
-- references the role column, then add a single canonical one.
-- ---------------------------------------------------------------------------
do $$
declare
  c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%in%'
  loop
    execute 'alter table public.profiles drop constraint ' || quote_ident(c);
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'submitter', 'customer', 'shipper'));

-- ---------------------------------------------------------------------------
-- Update signup trigger to accept 'shipper' as an invited role.
-- Email-based admin auto-promotion behavior is unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_emails text := current_setting('app.admin_emails', true);
  invited_role text := new.raw_app_meta_data->>'role';
  final_role text := 'customer';
begin
  if admin_emails is not null
     and lower(new.email) = any (
       array(
         select btrim(lower(part))
         from unnest(string_to_array(admin_emails, ',')) as part
       )
     ) then
    final_role := 'admin';
  elsif invited_role in ('admin', 'submitter', 'customer', 'shipper') then
    final_role := invited_role;
  end if;

  insert into public.profiles (id, email, role)
  values (new.id, new.email, final_role)
  on conflict (id) do update set email = excluded.email;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shoes: add nullable logistics_status column with check constraint.
-- Null means the logistics workflow hasn't started yet (e.g. shoe is still
-- 'upcoming' on the sales side and nothing has been ordered).
-- ---------------------------------------------------------------------------
alter table public.shoes add column if not exists logistics_status text;

do $$
declare
  c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.shoes'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%logistics_status%'
  loop
    execute 'alter table public.shoes drop constraint ' || quote_ident(c);
  end loop;
end $$;

alter table public.shoes
  add constraint shoes_logistics_status_check
  check (
    logistics_status is null
    or logistics_status in ('purchased', 'dispatched', 'arrived', 'delivered')
  );
