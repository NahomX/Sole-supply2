-- 0013_shoe_sizes_quantity — add quantity column to shoe_sizes.
--
-- Each shoe_sizes row represents one (shoe, US-size) combination. Until now,
-- quantity was implicitly 1 — to express "2 pairs of size 9" the submitter
-- had to create duplicate shoe entries (which was blocked by the unique
-- constraint anyway).
--
-- This migration adds a `quantity` column (integer, default 1, must be > 0).
-- Existing rows default to 1. No data migration needed — all existing rows
-- are single-quantity by definition.
--
-- Idempotent: uses a DO block that checks whether the column already exists.

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'shoe_sizes'
      and column_name  = 'quantity'
  ) then
    alter table public.shoe_sizes
      add column quantity integer not null default 1
      check (quantity > 0);
  end if;
end $$;
