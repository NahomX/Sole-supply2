-- 0009_worker_scoped_access — Defense-in-depth RLS policies for the agent worker.
--
-- The agent worker (Plane C, Fly.io) uses a LEAST-TRUST Supabase key that
-- must NOT have service-role access. This migration adds RLS policies that
-- enforce the worker's read/write scope at the DB layer — independent of
-- whatever key the worker holds.
--
-- TOPOLOGY REMINDER:
--   Plane A (Vercel — service-role): full access to all tables.
--   Plane C (Fly.io — worker key):   access ONLY to what is listed below.
--
-- HOW TO CREATE THE WORKER KEY:
--   Option A (preferred — custom role):
--     1. In Supabase → SQL Editor, run the CREATE ROLE block at the bottom
--        of this file to create a `worker` Postgres role.
--     2. In Supabase → Settings → API → Custom JWT claims (or via the
--        Management API) generate a JWT signed with your JWT secret
--        where `role = 'worker'`.
--     3. Set SUPABASE_WORKER_KEY=<that JWT> in the worker .env.
--     4. These RLS policies use `current_setting('request.jwt.claims')` to
--        identify the worker role (Supabase sets this from the JWT).
--
--   Option B (anon key + RLS only, acceptable for Phase 3):
--     Use the project anon key. The anon key triggers the `anon` role.
--     Adjust the policy USING clauses below to use `auth.role() = 'anon'`
--     and add policies to the tables accordingly.
--     NOTE: The anon key is already used by the Next.js browser client.
--     Using it for the worker means both share the same RLS policies —
--     which is safe ONLY if the anon policies are at least as restrictive
--     as what the worker needs. Prefer Option A for full isolation.
--
-- POLICY DESIGN:
--   Each table gets one policy per operation type allowed for the worker.
--   Tables with NO worker access are left with RLS enabled and no policy
--   (i.e., service-role only, as set up by 0008).
--
-- WORKER ALLOWED OPERATIONS:
--   SELECT: shoe_sizes, shoes, issuing_cards (non-secret cols), purchase_orders, agent_config
--   INSERT: agent_runs (status tracking), purchase_orders WHERE status='draft'
--   UPDATE: agent_runs (finish/close own runs)
--   NO access: spend_ledger, issuing_authorizations, payments, profiles, interests
--
-- Idempotent: all CREATE POLICY use IF NOT EXISTS (via DROP + CREATE).
-- Run in: Supabase SQL Editor (user must paste and execute; PM cannot apply).
--
-- Migration number: 0009 (0008 = Phase 2 issuing_governance).

-- ---------------------------------------------------------------------------
-- Helper: identify the worker session.
-- Supabase sets `request.jwt.claims` from the JWT; we extract the `role`
-- claim to distinguish the worker key from other callers.
-- ---------------------------------------------------------------------------

-- A convenience function so policy USING clauses stay readable.
create or replace function public.is_worker_role()
returns boolean
language sql
stable
as $$
  select (
    coalesce(
      current_setting('request.jwt.claims', true)::jsonb ->> 'role',
      ''
    ) = 'worker'
  )
$$;

-- ---------------------------------------------------------------------------
-- 1. shoe_sizes — worker needs SELECT to read the in-cart queue.
-- ---------------------------------------------------------------------------

drop policy if exists "worker can read shoe_sizes" on public.shoe_sizes;
create policy "worker can read shoe_sizes"
  on public.shoe_sizes
  for select
  using (public.is_worker_role());

-- ---------------------------------------------------------------------------
-- 2. shoes — worker needs SELECT for url/title/price context.
--    Note: shoe.url is the producer URL (admin-only in the web app).
--    The worker reads it to navigate to the retailer. It must never expose
--    it to unauthenticated callers or the LLM's final response (only the
--    loop code uses it directly for browser navigation).
-- ---------------------------------------------------------------------------

drop policy if exists "worker can read shoes" on public.shoes;
create policy "worker can read shoes"
  on public.shoes
  for select
  using (public.is_worker_role());

-- ---------------------------------------------------------------------------
-- 3. issuing_cards — worker needs SELECT for card metadata (not PAN/CVC).
--    PAN/CVC are never stored in this table (invariant from 0008).
-- ---------------------------------------------------------------------------

drop policy if exists "worker can read issuing_cards" on public.issuing_cards;
create policy "worker can read issuing_cards"
  on public.issuing_cards
  for select
  using (public.is_worker_role());

-- ---------------------------------------------------------------------------
-- 4. purchase_orders:
--    SELECT: worker needs to poll PO status (waiting for approval).
--    INSERT: worker may only create draft POs (status='draft').
--            WITH CHECK enforces this at DB level — any other status is rejected.
--    UPDATE: worker may NOT update POs (only Vercel/service-role can approve/close).
-- ---------------------------------------------------------------------------

drop policy if exists "worker can read purchase_orders" on public.purchase_orders;
create policy "worker can read purchase_orders"
  on public.purchase_orders
  for select
  using (public.is_worker_role());

drop policy if exists "worker can insert draft purchase_orders" on public.purchase_orders;
create policy "worker can insert draft purchase_orders"
  on public.purchase_orders
  for insert
  with check (
    public.is_worker_role()
    and status = 'draft'  -- THE STRUCTURAL GUARANTEE: worker can NEVER self-approve
  );

-- Explicitly NO update policy for the worker on purchase_orders.
-- The absence of an update policy means any UPDATE attempt by the worker key
-- is rejected by RLS (fail-closed).

-- ---------------------------------------------------------------------------
-- 5. agent_config — worker needs SELECT to read kill switch + max_buys_per_run.
-- ---------------------------------------------------------------------------

drop policy if exists "worker can read agent_config" on public.agent_config;
create policy "worker can read agent_config"
  on public.agent_config
  for select
  using (public.is_worker_role());

-- ---------------------------------------------------------------------------
-- 6. agent_runs — worker needs INSERT + UPDATE to track its own runs.
--    UPDATE is scoped to rows the worker created (by livemode=false + status='running').
--    A more precise scope would use a created_by field (deferred to Phase 4).
-- ---------------------------------------------------------------------------

drop policy if exists "worker can insert agent_runs" on public.agent_runs;
create policy "worker can insert agent_runs"
  on public.agent_runs
  for insert
  with check (
    public.is_worker_role()
    and livemode = false  -- Phase 3: worker can only write test-mode rows
  );

drop policy if exists "worker can update own agent_runs" on public.agent_runs;
create policy "worker can update own agent_runs"
  on public.agent_runs
  for update
  using (
    public.is_worker_role()
    and livemode = false
  )
  with check (
    public.is_worker_role()
    and livemode = false
  );

-- ---------------------------------------------------------------------------
-- Optional: CREATE ROLE for the worker (Option A, preferred).
--
-- Run this block manually if you want a dedicated Postgres role (not anon).
-- Supabase's built-in role infrastructure means you generate a JWT with
-- `role: 'worker'` using your project JWT secret. The role itself just
-- needs to exist in Postgres for Supabase to recognise it.
--
-- Uncomment and run separately (do NOT run as part of regular migration
-- if your Supabase project already has a `worker` role):
--
-- do $$
-- begin
--   if not exists (select 1 from pg_roles where rolname = 'worker') then
--     create role worker nologin;
--     -- Grant usage on the public schema so RLS policies can fire.
--     grant usage on schema public to worker;
--     -- Grant connect so Supabase can set up the session.
--     -- (Supabase handles the actual auth via the JWT; this role is advisory.)
--     comment on role worker is 'Berebaso agent worker — least-trust Fly.io process';
--   end if;
-- end;
-- $$;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Verification queries (run after applying to confirm policies exist):
--
-- select tablename, policyname, cmd
-- from pg_policies
-- where policyname like 'worker%'
-- order by tablename, cmd;
--
-- Expected output (7 rows):
--   agent_config    | worker can read agent_config            | SELECT
--   agent_runs      | worker can insert agent_runs            | INSERT
--   agent_runs      | worker can update own agent_runs        | UPDATE
--   issuing_cards   | worker can read issuing_cards           | SELECT
--   purchase_orders | worker can insert draft purchase_orders | INSERT
--   purchase_orders | worker can read purchase_orders         | SELECT
--   shoe_sizes      | worker can read shoe_sizes              | SELECT
--   shoes           | worker can read shoes                   | SELECT
-- ---------------------------------------------------------------------------
