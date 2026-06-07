-- 0010_shoe_events — timestamped audit log for all shoe status transitions.
--
-- Records WHEN events occur (created_at), WHAT changed (event_type, from_value, to_value),
-- and WHO/WHERE it came from (actor, source). All status transitions in the system
-- flow through lib/shoes.ts helpers, which call the INSERT hook at the moment of change.
--
-- Tables and transitions tracked:
--   1. Shoe creation (event_type='shoe_created')
--   2. Sales status change (event_type='sales_status_change', us_size=null)
--   3. Per-size logistics change (event_type='logistics_status_change', us_size set)
--
-- RLS: ENABLED with NO policies — service-role writes only (mirrors 0008_issuing_governance pattern).
-- Auditable reads happen via app/admin/page.tsx after fetching shoes. No direct user queries.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + INDEX IF NOT EXISTS.

create table if not exists public.shoe_events (
  id uuid primary key default gen_random_uuid(),
  -- Foreign key to the shoe this event concerns.
  shoe_id uuid not null references public.shoes(id) on delete cascade,
  -- For per-size events, the US size string (e.g. "9", "10.5").
  -- NULL for shoe-level events (creation, sales status).
  us_size text null,
  -- Event type: 'shoe_created', 'sales_status_change', 'logistics_status_change'.
  event_type text not null
    check (event_type in ('shoe_created', 'sales_status_change', 'logistics_status_change')),
  -- Old value (as text; null for creation).
  -- For sales_status: the previous ShoeStatus string.
  -- For logistics_status: the previous LogisticsStatus string or 'cleared' if it was null.
  from_value text null,
  -- New value (as text; null only in edge cases).
  -- For sales_status: the new ShoeStatus string.
  -- For logistics_status: the new LogisticsStatus string or 'cleared' if set to null.
  to_value text null,
  -- Actor label (human-readable: email address or Telegram username).
  -- Null if the action came from a bot/agent with no identifiable actor.
  actor text null,
  -- Source: 'web', 'incart', 'purchaser', 'work', 'agent', etc.
  -- Indicates the channel/bot/service that triggered the transition.
  source text null,
  -- When the event occurred (recorded at INSERT time).
  created_at timestamptz not null default now()
);

-- Index for fast lookups: recent events for a shoe.
create index if not exists shoe_events_shoe_created_idx
  on public.shoe_events (shoe_id, created_at desc);

-- Index for audit trails: all events of a given type.
create index if not exists shoe_events_type_created_idx
  on public.shoe_events (event_type, created_at desc);

alter table public.shoe_events enable row level security;

-- No policies: service-role only. The admin UI fetches via supabaseService().
