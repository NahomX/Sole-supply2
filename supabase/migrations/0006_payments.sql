-- 0006_payments — Chapa payment integration (admin-only POC).
--
-- Stores the state of each payment transaction initialized via the Chapa
-- test-mode API. Reads/writes happen exclusively through the service-role
-- client in lib/payments.ts — there are NO public or authenticated RLS
-- policies, so the data is never accessible via the Supabase anon key or
-- from client components.
--
-- Idempotent: safe to re-run on a database that already has the table.

create table if not exists public.payments (
  id              uuid         primary key default gen_random_uuid(),
  shoe_id         uuid         null references public.shoes(id) on delete set null,
  size            text         null,
  amount          numeric      not null,
  currency        text         not null default 'ETB',
  tx_ref          text         not null unique,
  status          text         not null default 'pending'
                               check (status in ('pending', 'paid', 'failed')),
  chapa_ref       text         null,
  customer_email  text         null,
  created_at      timestamptz  not null default now(),
  updated_at      timestamptz  not null default now()
);

-- RLS: enabled; no policies — service-role bypasses RLS entirely.
-- Authenticated users and anon callers have zero access to this table.
alter table public.payments enable row level security;

-- Drop any pre-existing policy so the migration is idempotent.
drop policy if exists "payments service only" on public.payments;

-- updated_at auto-maintenance trigger (idempotent).
create or replace function public.set_payments_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_payments_updated_at();
