-- 0008_issuing_governance — Stripe Issuing governance rails (Phase 2, TEST mode only).
--
-- Creates six tables for the spend-governance layer:
--   issuing_cards        — virtual cards provisioned via Stripe Issuing.
--   purchase_orders      — human-approved single-use spend authorizations.
--   issuing_authorizations — L2 webhook decision log (approve/decline).
--   spend_ledger         — per-card running spend (reservations + settlements).
--   agent_runs           — Phase 3 agent execution log (Phase 2 = empty).
--   agent_config         — singleton kill-switch row (agent_enabled default false).
--
-- INVARIANTS encoded here:
--   * purchase_orders.max_amount_cents CHECK <= 30000 ($300).
--   * purchase_orders.status CHECK on the PO lifecycle.
--   * Every money row carries a `livemode boolean` for test/live guard.
--   * RLS is ENABLED on every table with NO policies — service-role only.
--     The pattern mirrors 0006_payments.sql (Chapa POC).
--   * issuing_cards has a partial unique index on (card_id) WHERE status='open'
--     (enforces one open PO per card at DB level).
--   * updated_at triggers follow the style established in 0006.
--
-- Idempotent: all CREATE statements use IF NOT EXISTS; triggers use
-- DROP TRIGGER IF EXISTS before re-creation; the agent_config seed uses
-- INSERT ... ON CONFLICT DO NOTHING.
--
-- Migration number: 0008 (0007 = Phase 1 purchaser_role).
-- Applies to: Supabase project backing NahomX/Sole-supply2.
-- Run in: Supabase SQL Editor (user must paste and execute; PM cannot apply).

-- ---------------------------------------------------------------------------
-- Helper: generic updated_at trigger function (idempotent CREATE OR REPLACE).
-- The same function can be reused by all tables in this migration.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. issuing_cards — virtual cards provisioned via Stripe Issuing.
--    Stores only the non-sensitive identifiers; PAN/CVC are NEVER stored.
-- ---------------------------------------------------------------------------
create table if not exists public.issuing_cards (
  id              uuid primary key default gen_random_uuid(),
  -- Stripe card + cardholder IDs (both required for freeze / retrieve operations).
  stripe_card_id    text not null unique,
  stripe_cardholder_id text not null,
  -- Last-4 digits only — safe to store; PAN never stored.
  last4           text not null check (length(last4) = 4),
  -- livemode: false = Stripe test mode; true = live. Copied from the Stripe object.
  livemode        boolean not null default false,
  -- status mirrors Stripe card status vocabulary.
  status          text not null default 'active'
                    check (status in ('active', 'inactive', 'canceled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.issuing_cards enable row level security;
-- No policies: service-role only.

drop trigger if exists issuing_cards_updated_at on public.issuing_cards;
create trigger issuing_cards_updated_at
  before update on public.issuing_cards
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. purchase_orders — the human-approved spend interlock.
--
--    Lifecycle: draft -> open -> authorizing -> closed
--                                            -> cancelled (purchaser declines)
--                                            -> failed    (capture mismatch)
--
--    One PO = one authorization = one set of size_ids.
-- ---------------------------------------------------------------------------
create table if not exists public.purchase_orders (
  id              uuid primary key default gen_random_uuid(),
  -- The virtual card this PO is associated with.
  card_id         uuid not null references public.issuing_cards(id),
  -- shoe_sizes.id[] — exactly which size rows this PO covers.
  size_ids        uuid[] not null default '{}',
  -- Human-readable retailer domain (e.g. "nike.com") for audit + MCC matching.
  retailer_domain text,
  -- Ceiling amount in cents; CHECK enforces the $300/auth hard cap.
  max_amount_cents integer not null check (max_amount_cents > 0 and max_amount_cents <= 30000),
  -- PO lifecycle.
  status          text not null default 'draft'
                    check (status in ('draft', 'open', 'authorizing', 'closed', 'cancelled', 'failed')),
  -- Single-use guard: set to true on first authorization attempt.
  single_use      boolean not null default true,
  single_use_consumed boolean not null default false,
  -- Human approval fields (set when status transitions draft -> open).
  approved_by     bigint,          -- telegram_id of the purchaser who tapped Approve
  approved_at     timestamptz,
  expires_at      timestamptz,     -- ~30 min from approval; enforced in L2 webhook
  -- Stripe authorization correlation (set when L2 approves).
  stripe_authorization_id text unique,
  -- livemode must match the card's livemode.
  livemode        boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.purchase_orders enable row level security;
-- No policies: service-role only.

drop trigger if exists purchase_orders_updated_at on public.purchase_orders;
create trigger purchase_orders_updated_at
  before update on public.purchase_orders
  for each row execute function public.set_updated_at();

-- Partial unique index: at most one open PO per card at a time.
-- This is a DB-level enforcement of the "one PO = one auth" invariant.
create unique index if not exists purchase_orders_card_open_uniq
  on public.purchase_orders (card_id)
  where (status = 'open');

-- Index for fast L2 lookup by card_id + status (hot path: must fit in 2s).
create index if not exists purchase_orders_card_status_idx
  on public.purchase_orders (card_id, status);

-- ---------------------------------------------------------------------------
-- 3. issuing_authorizations — L2 webhook decision log.
--    One row per authorization request/updated event from Stripe.
-- ---------------------------------------------------------------------------
create table if not exists public.issuing_authorizations (
  id                  uuid primary key default gen_random_uuid(),
  -- Stripe's own authorization object id.
  stripe_auth_id      text not null unique,
  card_id             uuid references public.issuing_cards(id),
  purchase_order_id   uuid references public.purchase_orders(id),
  -- Amount Stripe is requesting approval for (in cents).
  amount_cents        integer,
  currency            text,
  -- MCC of the merchant.
  merchant_category   text,
  merchant_name       text,
  -- Decision made by the L2 webhook.
  decision            text not null check (decision in ('approved', 'declined')),
  decline_reason      text,   -- populated on decline; null on approve
  -- livemode from the Stripe event.
  livemode            boolean not null default false,
  created_at          timestamptz not null default now()
);

alter table public.issuing_authorizations enable row level security;
-- No policies: service-role only.

create index if not exists issuing_authorizations_card_idx
  on public.issuing_authorizations (card_id);

-- ---------------------------------------------------------------------------
-- 4. spend_ledger — per-card running spend tracker.
--
--    Reservation rows are written on approve (status='reserved').
--    Settlement rows are written on capture (status='settled').
--    Idempotent on stripe_authorization_id.
-- ---------------------------------------------------------------------------
create table if not exists public.spend_ledger (
  id                      uuid primary key default gen_random_uuid(),
  card_id                 uuid not null references public.issuing_cards(id),
  purchase_order_id       uuid references public.purchase_orders(id),
  stripe_authorization_id text not null,
  -- Amount in cents (positive = spend, negative would be refund).
  amount_cents            integer not null,
  currency                text not null default 'usd',
  -- reserved = auth approved but not yet captured; settled = captured.
  status                  text not null check (status in ('reserved', 'settled', 'voided')),
  livemode                boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table public.spend_ledger enable row level security;
-- No policies: service-role only.

drop trigger if exists spend_ledger_updated_at on public.spend_ledger;
create trigger spend_ledger_updated_at
  before update on public.spend_ledger
  for each row execute function public.set_updated_at();

-- Idempotent constraint: one ledger row per (card, authorization).
create unique index if not exists spend_ledger_auth_uniq
  on public.spend_ledger (stripe_authorization_id);

create index if not exists spend_ledger_card_idx
  on public.spend_ledger (card_id, status);

-- ---------------------------------------------------------------------------
-- 5. agent_runs — Phase 3 agent execution audit log.
--    Phase 2 only creates the table; Phase 3 will populate it.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_runs (
  id          uuid primary key default gen_random_uuid(),
  -- Phase 3: Claude agent loop invocations. Columns are advisory for Phase 2.
  status      text not null default 'running'
                check (status in ('running', 'completed', 'failed', 'killed')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  -- JSON summary of what the run did (shoes attempted, POs created, errors).
  summary     jsonb,
  livemode    boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table public.agent_runs enable row level security;
-- No policies: service-role only.

-- ---------------------------------------------------------------------------
-- 6. agent_config — singleton kill-switch.
--    Phase 2 seeds one row with agent_enabled=false.
--    Phase 3 reads this before each agent loop iteration.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_config (
  id              integer primary key default 1 check (id = 1),  -- singleton
  agent_enabled   boolean not null default false,
  -- How many shoes the agent may attempt per run (Phase 3 guard).
  max_buys_per_run integer not null default 3 check (max_buys_per_run >= 0),
  updated_at      timestamptz not null default now()
);

alter table public.agent_config enable row level security;
-- No policies: service-role only.

drop trigger if exists agent_config_updated_at on public.agent_config;
create trigger agent_config_updated_at
  before update on public.agent_config
  for each row execute function public.set_updated_at();

-- Seed the singleton kill-switch row (idempotent).
insert into public.agent_config (id, agent_enabled, max_buys_per_run)
values (1, false, 3)
on conflict (id) do nothing;
