# Tier 3 (future): agentic, human-approved structural site changes

> **Status: SPECULATIVE / PREMATURE. Do not build this yet.** This document
> sketches a possible Tier 3 for the site-edit bot. It is intentionally written
> *before* there is any reason to build it, so the design is on record. See
> [Premature — do not build yet](#premature--do-not-build-yet) at the bottom.

## Where this fits

The site-edit work ships in tiers:

- **Tier 1 — helpers.** Server-only functions that actually mutate storefront
  data, always with an audit trail: `setCopy` (`lib/site-copy.ts`),
  `updateShoeField`, `setSalesStatus`, `softRemoveShoe` (`lib/shoes.ts`). These
  hold the service-role key, validate their inputs, and never throw. They are
  the *only* sanctioned way to change the live site.
- **Tier 2 — human-driven bot.** The Telegram site-edit bot lets an allow-listed
  admin edit copy and shoe fields by tapping inline keyboards. A human chooses
  every value; the bot just calls the Tier-1 helpers.
- **Tier 3 — agentic proposals (this doc).** An LLM may *propose* larger or
  structural changes (e.g. reword a whole section, restructure copy, bulk
  re-status a batch of shoes), but it can never apply them itself. It writes a
  **proposal** to a new `pending_site_changes` table; a human approves or
  declines from the ops bot; only an admin **Approve** runs the Tier-1 helpers.

The trust model is copied directly from the autonomous purchasing agent
(PR #30). There, the Fly.io worker LLM can *draft* a purchase order but can
**never** approve it — RLS only lets it insert rows with `status = 'draft'`,
and a purchaser taps Approve in the bot to flip `draft → open`. Tier 3 is the
same shape applied to the website: **propose-only LLM + DB-enforced gate +
human approval + privileged apply step.**

## The PO pattern we are mirroring

From `supabase/migrations/0009_worker_scoped_access.sql`, the worker key gets
an INSERT policy and *no* UPDATE policy on `purchase_orders`:

```sql
create policy "worker can insert draft purchase_orders"
  on public.purchase_orders
  for insert
  with check (
    public.is_worker_role()
    and status = 'draft'  -- THE STRUCTURAL GUARANTEE: worker can NEVER self-approve
  );
-- Explicitly NO update policy for the worker → any UPDATE is rejected (fail-closed).
```

Approval lives in the bot (`lib/bots/handlers.ts`, purchaser `/pending`): an
allow-listed human taps Approve, and a service-role update flips
`draft → open` guarded by `.eq("status", "draft")`. The LLM writes; only a
human, via the privileged plane, applies.

## Schema sketch: `pending_site_changes`

A proposal is a row describing *what the LLM wants to do*, never the live data
itself. It names a target Tier-1 helper plus its arguments, so applying a
proposal is just "call this helper with these args."

```sql
create table if not exists public.pending_site_changes (
  id           uuid primary key default gen_random_uuid(),

  -- WHAT to do, expressed as a Tier-1 helper call (not raw SQL).
  -- e.g. 'set_copy' | 'update_shoe_field' | 'set_sales_status' | 'soft_remove_shoe'
  action       text not null,
  -- JSON args for the helper, validated against `action` at apply time.
  -- e.g. {"key":"hero_tagline","lang":"en","value":"..."}
  payload      jsonb not null,

  -- WHY — the LLM's rationale + a human-readable summary for the approver.
  summary      text not null,
  rationale    text,

  -- WHO/lifecycle — mirrors purchase_orders.status semantics exactly.
  status       text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'applied', 'failed')),
  proposed_by  text not null default 'llm',     -- which agent/model proposed it
  reviewed_by  text,                            -- telegram id of approver
  reviewed_at  timestamptz,
  applied_at   timestamptz,
  apply_error  text,                            -- set if status = 'failed'

  created_at   timestamptz not null default now()
);

alter table public.pending_site_changes enable row level security;
```

Notes:
- `action` + `payload` is deliberately a *constrained* shape, not free SQL. The
  apply step switches on `action` and dispatches to a known Tier-1 helper. The
  LLM cannot describe an operation that no helper implements.
- `status` mirrors the PO lifecycle: `pending` is the only state the LLM may
  write, exactly like `draft` for purchase orders. Everything past `pending`
  is reachable only via the service-role apply path.

## RLS policy idea

Same defense-in-depth as `0009`: give the LLM/agent key an INSERT policy that
pins `status = 'pending'`, a SELECT policy so it can see its own proposals'
outcomes, and **no UPDATE/DELETE policy at all** so it can never advance,
approve, or rewrite a proposal. Writes that move a row forward happen only
under the service-role key from the bot.

```sql
-- LLM/agent role may propose, and only as 'pending'.
create policy "agent can insert pending site changes"
  on public.pending_site_changes
  for insert
  with check (
    public.is_worker_role()          -- or a dedicated is_site_agent_role()
    and status = 'pending'           -- THE GATE: agent can NEVER self-approve
    and proposed_by = 'llm'
  );

-- LLM/agent role may read proposals (to learn approve/decline outcomes).
create policy "agent can read site changes"
  on public.pending_site_changes
  for select
  using (public.is_worker_role());

-- Deliberately NO update / NO delete policy for the agent role → fail-closed.
-- Approve/decline/apply run under the service-role key from the ops bot.
```

The `status = 'pending'` `WITH CHECK` is the structural guarantee, identical in
spirit to PO's `WITH CHECK status = 'draft'`. Even a fully compromised /
jailbroken LLM holding the agent key cannot transition a row to `approved` or
`applied`: there is no policy that permits it.

## Approval flow (ops bot)

Mirrors the purchaser `/pending` UX in `lib/bots/handlers.ts`:

1. **Propose.** The LLM writes a `pending` row (action + payload + summary +
   rationale). Nothing changes on the live site.
2. **List.** An admin runs `/site_pending` (or the site-edit bot's equivalent).
   The handler selects `status = 'pending'` and renders one message per
   proposal with the human-readable `summary` and inline
   **Approve** / **Decline** buttons (`site_approve:{id}` / `site_decline:{id}`),
   exactly like `po_approve:` / `po_decline:`.
3. **Guard every tap.** `guardAllowlist` re-verifies the tapper is an admin on
   every callback (the PO flow re-checks on each callback too) — no trusting a
   stale message.
4. **Decline.** Service-role update sets `status = 'declined'`, guarded by
   `.eq("status", "pending")`. Nothing is applied.
5. **Approve = apply.** On Approve, the handler (service-role):
   - optimistically claims the row: `update ... set status='approved',
     reviewed_by, reviewed_at where id = ? and status = 'pending'` and bails if
     nothing was claimed (someone already acted on it);
   - dispatches `action` + `payload` to the matching **Tier-1 helper**
     (`setCopy` / `updateShoeField` / `setSalesStatus` / `softRemoveShoe`) —
     reusing the same validated, audited code path Tier 2 already uses;
   - on success sets `status = 'applied'`, `applied_at = now()`; on helper error
     sets `status = 'failed'`, `apply_error = <message>` and reports back.

Because apply goes through the Tier-1 helpers, the existing `shoe_events` /
`updated_by` audit trail records the change with the approving admin, and the
storefront's DEFAULTS fallback still protects against bad copy keys.

## Why it's gated this way

- **The LLM can propose but never apply.** The whole point: an LLM proposing
  structural changes is useful, but an LLM that can *apply* them is an
  unbounded liability on a live storefront. Splitting propose from apply keeps a
  human in the loop on every change that reaches customers.
- **The gate is in the database, not just the app.** Like `0009`, the
  `WITH CHECK status = 'pending'` plus the absence of an UPDATE policy means the
  guarantee holds even if the bot code has a bug or the agent key leaks. Prompt
  injection cannot grant a capability the DB role does not have.
- **Apply reuses Tier-1, not raw SQL.** Proposals name a helper + args, so every
  applied change inherits Tier-1's validation, audit logging, and fallbacks.
  The agent never gets a generic "run SQL" capability.
- **Least privilege.** The agent role reads what it needs and writes only
  `pending` proposals. It has no access to spend, payments, profiles, or any of
  the tables `0008`/`0009` already wall off.

## Premature — do not build yet

**This should not be built until Tiers 1 and 2 have run in production for a
good while** and we have evidence they're stable and genuinely used. Reasons:

- Tier 2 (a human editing via the bot) already covers essentially every edit we
  can foresee. We have no demonstrated need for an LLM to propose structural
  changes — building Tier 3 now is solving a problem we don't have.
- Every Tier 3 surface (a new table, a new RLS role, an apply dispatcher, LLM
  prompt plumbing) is attack surface and maintenance cost. Adding it before
  Tiers 1–2 have earned trust inverts the right order of operations.
- The apply dispatcher is only as safe as the Tier-1 helpers it calls. Those
  helpers should be battle-tested by real human use first, so Tier 3 inherits
  proven code rather than co-evolving with it.

When (if) we revisit this, the prerequisites are: Tiers 1–2 stable in prod with
a real audit-trail history; a concrete, recurring use case an LLM proposer
actually improves; and a dedicated least-trust agent role (not a reused key)
with the RLS above. Until then, this file is a design note, not a backlog item.
