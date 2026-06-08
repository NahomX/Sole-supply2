-- 0007_purchaser_role — add 'purchaser' role to telegram_users.
--
-- Changes:
--   1. Extend the telegram_users.role CHECK constraint from
--      ('admin','shipper') to ('admin','shipper','purchaser').
--   2. Add a trigger that enforces a hard cap of MAX 2 purchasers.
--      Attempting to INSERT or UPDATE a row to role='purchaser' when
--      two purchaser rows already exist (excluding the row being updated)
--      raises an exception and rolls back the statement.
--
-- Idempotent: safe to re-run. The DO block drops the old constraint
-- by scanning pg_constraint (same pattern as 0003_logistics_in_cart.sql).
-- The trigger function uses CREATE OR REPLACE; the trigger itself is
-- dropped-if-exists before being re-created.
--
-- No data migration needed — no existing rows hold role='purchaser' yet.

-- ---------------------------------------------------------------------------
-- Step 1 — reseat the role CHECK constraint to include 'purchaser'.
-- ---------------------------------------------------------------------------
do $$
declare
  c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.telegram_users'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute 'alter table public.telegram_users drop constraint ' || quote_ident(c);
  end loop;
end $$;

alter table public.telegram_users
  add constraint telegram_users_role_check
  check (role in ('admin', 'shipper', 'purchaser'));

-- ---------------------------------------------------------------------------
-- Step 2 — trigger function: enforce MAX 2 purchasers.
-- ---------------------------------------------------------------------------
create or replace function public.check_purchaser_cap()
returns trigger
language plpgsql
as $$
declare
  current_count int;
begin
  if NEW.role = 'purchaser' then
    select count(*) into current_count
    from public.telegram_users
    where role = 'purchaser'
      and telegram_id <> NEW.telegram_id;

    if current_count >= 2 then
      raise exception
        'Maximum of 2 purchasers allowed. Remove an existing purchaser before adding another.';
    end if;
  end if;
  return NEW;
end;
$$;

-- Drop the trigger if it already exists (idempotency).
drop trigger if exists enforce_purchaser_cap on public.telegram_users;

create trigger enforce_purchaser_cap
  before insert or update on public.telegram_users
  for each row execute function public.check_purchaser_cap();
