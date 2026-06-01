-- 0003_logistics_in_cart — evolves the logistics status enum.
--
-- Old flow:  purchased → dispatched → arrived → delivered
-- New flow:  in_cart → purchased → arrived → delivered
--
-- Changes:
--   1. 'dispatched' is removed from the workflow entirely.
--   2. Any existing row that holds 'dispatched' is remapped to 'purchased'
--      (conservative: treat in-transit items as already confirmed purchased).
--   3. 'in_cart' is added as a pre-purchase holding state (shoe added to the
--      retailer's cart but not yet bought).
--
-- ORDER MATTERS: the UPDATE must run BEFORE the constraint is reseated.
-- Tightening the constraint while 'dispatched' rows exist would fail.
--
-- Idempotent: safe to re-run. The DO block drops the old constraint by name
-- (or any constraint referencing logistics_status) before adding the new one.

-- ---------------------------------------------------------------------------
-- Step 1 — remap legacy 'dispatched' rows to 'purchased'.
-- ---------------------------------------------------------------------------
update public.shoes
set logistics_status = 'purchased'
where logistics_status = 'dispatched';

-- ---------------------------------------------------------------------------
-- Step 2 — reseat the check constraint with the new value set.
-- Drop any existing constraint that references logistics_status, then add
-- the canonical one for the new flow.
-- ---------------------------------------------------------------------------
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
    or logistics_status in ('in_cart', 'purchased', 'arrived', 'delivered')
  );
