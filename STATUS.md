# Sole Supply — STATUS

**Version:** 20
**Last updated:** 2026-06-13 (pm-sole-supply — PR #35 updated: photo-match swapped from Claude to Gemini, CI green, mergeable)
**State:** 1 PR open (#35 feat/shipper-confirm-receipt — Vercel CI SUCCESS, MERGEABLE, user-confirmed design). Main branch `f090cd6` contains everything through PR #34. All 34 prior PRs are closed (32 merged, 2 closed-not-merged: #9, #21). All 12 migrations applied.

**Owner:** `pm-sole-supply` (sole writer of this file). **Repo:** `NahomX/Sole-supply2` (public). **Local:** `/mnt/c/Users/Nahom/Documents/claude-sandbox/sole-supply/`.

---

## Product in one paragraph

A Next.js 14 + Supabase web app for a **sneaker-importing workflow, US to Addis Ababa**. It is a procurement queue + storefront preview + interest tracker + logistics pipeline (no automated checkout -- a human buys each shoe). Brand name: **Berebaso** (bilingual EN/Amharic). Roles: **customer** (browse `/`, tap "I want this"), **submitter** (paste retailer URLs at `/submit`, OG-scraped), **shipper** (flip logistics status in `/admin`), **purchaser** (max-2 concurrent purchases, bot-gated), **admin** (everything). Deployed on Vercel; auth via Supabase magic links; RLS on. **Six interactive Telegram bots** (grammY, webhook-based) handle ops workflow. **Stripe Issuing governance rails** (Phase 2) and **autonomous agent worker** (Phase 3) are on main in TEST mode only. **Admin dashboard** has filter bar + shoe_events audit timeline. **Migration CI pipeline** automates SQL application with approval gate for destructive changes. **Storefront redesigned** (PR #34): ink/cream/orange design system, Unbounded display font, image-first cards, `/shoe/[id]` details page, admin-set birr prices, hands-on video pipeline.

## The data model -- two status tracks (locked)

Each `shoes` row carries two independent tracks:
- **Sales status** `shoes.status` (admin): `upcoming -> available -> sold`
- **Logistics status** per size via `shoe_sizes.logistics_status` (nullable; admin/shipper/purchaser): `in_cart -> purchased -> arrived -> delivered`
  - Per-size model landed in PR #26 (Phase 1) + PR #18 (Phase 2 drill-down bot UX). The old scalar `shoes.logistics_status` column was dropped by migration 0005.

Each enum is mirrored in **four places that must stay in sync**: the DB check constraint (`supabase/migrations/`), the TS type (`lib/supabase.ts`), the API validation array (`lib/shoes.ts` -- canonical source, imported by the API route), and the admin dropdown array (`app/admin/AdminDashboard.tsx`).

---

## OPEN PRs

### PR #35 `feat/shipper-confirm-receipt` — OPEN, CI green, MERGEABLE, confirmed-as-built

**Vercel CI:** SUCCESS. **GitHub mergeable:** MERGEABLE. **Design:** User-confirmed (all 4 blocking questions answered, all match defaults as built). **Ready to merge** pending user approval and `GEMINI_API_KEY` in Vercel for the photo-match flow.

**Two features in one branch** (no schema changes, no new migrations):

**Feature A — Shipper quick-action UI** (`app/admin/AdminDashboard.tsx`):
- Per-size quick-action buttons: "Arrived" / "Delivered" / "Purchased" — one tap instead of a dropdown
- Shipper-simplified view: hides dropdown entirely, shows status label + quick-action button only
- Batch "Mark all" button at shoe level (e.g. "Arrived all (3)") with confirm dialog
- Admin view: quick-action button primary + dropdown de-emphasised below it

**Feature B — AI photo-matching via Telegram** (`lib/shoe-matcher.ts` NEW + `lib/bots/handlers.ts`):
- `message:photo` handler on all three work bots (purchaser, arrived, delivery)
- Gemini `gemini-2.5-flash` vision (`@google/genai` SDK) compares the photo against catalog `image_url`s (up to 8 candidates, 30s timeout)
- Inline keyboard confirmation: top 3 matches with confidence labels + "None of these"
- On confirm: `advanceAllSizes()` advances all eligible sizes to the bot's `toStatus`
- Requires `GEMINI_API_KEY` in Vercel (reuses the same key if set for other Gemini features)
- Callback scheme: `phm:{shoeId}` (40 bytes max), `phm_no`

---

## What's on main (`f090cd6`)

### Merge history (PRs #1--#34, chronological)

**Foundation (PRs #1--#8, through 2026-06-01):**
- #1 Supabase auth + RLS
- #2 Fix Vercel build (supabaseServer split)
- #3 Fix Vercel type-check (setAll cookie)
- #4 Info popover (replace per-card sign-in nag)
- #5 Move schema into `supabase/migrations/0001_init.sql`
- #6 Gate producer URL to admins (close info-popover leak)
- #7 Shipper role + `logistics_status` + Footlocker scraper fix
- #8 M2+M3: `in_cart` logistics state, remove `dispatched`, friendly customer labels

**Telegram bots stack (PRs #10--#13, merged 2026-06-03 to 2026-06-04):**
- #10 PR A: bots infra + customer bot (grammY, webhooks, `lib/shoes.ts` extraction, `0004_telegram_users.sql`)
- #11 PR B: work bots + ops bot + stale-digest repoint + `set-webhooks.mjs`
- #12 PR C: shared ops feed (`postOpsFeed`, `OPS_FEED_CHAT_ID`)
- #13 Berebaso rebrand + bilingual EN/Amharic UI + visual hero + bot onboarding
- #14 Berebaso rebrand (early merge)

**Size features (PRs #15--#19, merged 2026-06-03 to 2026-06-04):**
- #15 Size availability grid on shoe cards (`lib/sizes.ts`, `SizeStrip` component)
- #16 Per-size status Phase 1: `shoe_sizes` table + per-size logistics pipeline (`0005_shoe_sizes.sql`)
- #17 STATUS.md v13 commit
- #18 Per-size status Phase 2: per-size drill-down bot UX
- #19 Telegram bots merge

**Payment + governance (PRs #20--#30, merged 2026-06-08):**
- #20 Chapa payment integration (admin-only test-mode POC, `0006_payments.sql`)
- #22 Stripe Issuing governance rails Phase 2 TEST mode (original, merged into orphan branch)
- #23 Phase 3 agent worker (original, merged into orphan branch)
- #24 Migration automation: runner (`scripts/migrate.mjs`) + CI pipeline (`.github/workflows/migrate.yml`) with approval gate
- #25 Admin filter bar + `shoe_events` audit timeline (`0010_shoe_events.sql`)
- #26 Per-size status Phase 1 (merge to main)
- #27 Stale attention banner + per-row admin badge (replaces #9)
- #28 Purchaser role + max-2 cap + bot re-gate Phase 1 (`0007_purchaser_role.sql`, replaces #21)
- #29 Stripe Issuing governance rails v2 Phase 2 TEST mode (`0008_issuing_governance.sql`)
- #30 Phase 3 autonomous agent worker v2 TEST mode (`0009_worker_scoped_access.sql`, `worker/` directory, Fly.io)

**Storefront fixes + ops-bot editing (PRs #31--#33, merged 2026-06-08 to 2026-06-09):**
- #31 In-stock sizes show available + Amharic "In stock" badge
- #32 In-stock sizes use `arrived` truth + auto-arrive on `available`
- #33 Ops-bot website editing Tiers 1+2 (structured + NL) + Tier 3 design doc (`0011_site_copy.sql`)

**Storefront redesign (PR #34, merged 2026-06-11):**
- #34 Berebaso redesign + birr price-setter + hands-on video pipeline (`0012_price_etb_video.sql`)

### All prior PRs (#1--#34)
All 34 prior PRs are closed (32 merged, 2 closed-not-merged: #9 superseded by #27, #21 superseded by #28).

---

## Migrations on main

| File | Description | Applied? |
|------|-------------|----------|
| `0001_init.sql` | Base schema (users, shoes, interests, RLS) | YES (confirmed) |
| `0002_logistics.sql` | Shipper role + logistics_status | YES (confirmed) |
| `0003_logistics_in_cart.sql` | in_cart replaces dispatched | YES (confirmed 2026-06-02) |
| `0004_telegram_users.sql` | Telegram bot allowlist table | YES (applied per Nahom 2026-06-11, unverified) |
| `0005_shoe_sizes.sql` | shoe_sizes table, per-size logistics, DROP shoes.logistics_status | YES (applied per Nahom 2026-06-11, unverified) |
| `0006_payments.sql` | Chapa payment tables (test-mode) | YES (applied per Nahom 2026-06-11, unverified) |
| `0007_purchaser_role.sql` | Purchaser role, max-2 cap | YES (applied per Nahom 2026-06-11, unverified) |
| `0008_issuing_governance.sql` | Stripe Issuing: issuing_cards, purchase_orders, issuing_authorizations, spend_ledger, agent_runs, agent_config (6 tables, livemode columns) | YES (applied per Nahom 2026-06-11, unverified) |
| `0009_worker_scoped_access.sql` | is_worker_role() helper, 8 RLS policies, worker structural guardrails | YES (applied per Nahom 2026-06-11, unverified) |
| `0010_shoe_events.sql` | shoe_events audit log table + indexes | YES (applied per Nahom 2026-06-11, unverified) |
| `0011_site_copy.sql` | Site copy storage for ops-bot editing | YES (applied per Nahom 2026-06-11, unverified) |
| `0012_price_etb_video.sql` | `shoes.price_etb`, `shoes.video_url`, public `shoe-videos` storage bucket | YES (applied per Nahom 2026-06-11, unverified) |

**Migration CI (PR #24)** is on main: `scripts/migrate.mjs` + `.github/workflows/migrate.yml`. But it requires one-time setup before it can auto-apply -- see USER ACTIONS below.

---

## Vercel env vars status

### Telegram bots (6 tokens + webhook secret + ops feed):
| Variable | Status |
|----------|--------|
| `TELEGRAM_WEBHOOK_SECRET` | UNCONFIRMED |
| `CUSTOMER_BOT_TOKEN` | UNCONFIRMED |
| `INCART_BOT_TOKEN` | UNCONFIRMED |
| `PURCHASER_BOT_TOKEN` | UNCONFIRMED |
| `ARRIVED_BOT_TOKEN` | UNCONFIRMED |
| `DELIVERY_BOT_TOKEN` | UNCONFIRMED |
| `OPS_BOT_TOKEN` | UNCONFIRMED |
| `OPS_FEED_CHAT_ID` | UNCONFIRMED |
| `CRON_SECRET` | UNCONFIRMED |

### Payments / Stripe Issuing (TEST mode):
| Variable | Status |
|----------|--------|
| `CHAPA_SECRET_KEY` | UNCONFIRMED |
| `STRIPE_SECRET_KEY` (rk_test_*) | UNCONFIRMED |
| `STRIPE_WEBHOOK_SECRET` | UNCONFIRMED |

### AI photo-matching (work bots):
| Variable | Status |
|----------|--------|
| `GEMINI_API_KEY` | UNCONFIRMED |

### Ops-bot site editing (Tier 2 NL, optional):
| Variable | Status |
|----------|--------|
| `ANTHROPIC_API_KEY` | UNCONFIRMED |
| `SITE_EDIT_NL_ENABLED` | UNCONFIRMED (set `true` to enable NL editing) |

---

## OUTSTANDING USER ACTIONS (prioritized)

### P0 -- COMPLETED: Migration application (was HIGH -- blocking multiple features)

**RESOLVED 2026-06-11.** Nahom applied migrations 0004--0012 in Supabase SQL Editor. PM cannot independently verify (no `DATABASE_URL` in this env; `npm run migrate:check` requires it). Recorded as "applied per Nahom, unverified." If any migration failed silently, the corresponding feature will surface errors at runtime (see Feature Readiness below).

**Verification path (optional but recommended):** Set `DATABASE_URL` locally and run `npm run migrate:check`. The script queries the `_migrations` tracking table (if it exists) and reports any pending files. Alternatively, confirm in Supabase Table Editor that these tables exist: `telegram_users`, `shoe_sizes`, `payments`/`payment_items`, `issuing_cards`, `purchase_orders`, `shoe_events`, `site_copy`, and that `shoes` has columns `price_etb` and `video_url`.

### P0 -- Migration CI baseline (one-time setup, prevents future manual applies)

Now that all 12 migrations are applied, baseline the tracking table so future merges auto-apply via PR #24's CI:
1. **Add `DATABASE_URL` repository secret** in GitHub: Settings > Secrets > Actions. Use Supabase direct/session connection string (port 5432, NOT the pooler on 6543). See `supabase/migrations/AUTOMATION.md`.
2. **Create `production` GitHub Environment** with required reviewers: Settings > Environments > New > name `production` > enable Required reviewers > add yourself.
3. **Run baseline once** from a machine with `DATABASE_URL` set:
   ```
   export DATABASE_URL="postgresql://postgres.<ref>:<password>@db.<ref>.supabase.co:5432/postgres"
   npm ci
   npm run migrate:baseline
   ```
   This records all 12 migrations in `_migrations` without re-running them. After this, any new migration file merged to main will auto-apply (additive) or gate behind an approval (destructive).

### P1 -- Storefront content (Nahom owes these)

PR #34 is merged and migration 0012 is applied. Remaining content tasks:
1. Supply **real store address** for the Visit-us section (currently placeholder: "Bole Road, Addis Ababa")
2. Supply **real phone number** (currently placeholder: "+251 9XX XXX XXX")
3. Confirm/update the **@berebaso Telegram handle** in the Visit-us section
4. Optionally register `/setprice` + `/clearvideo` with BotFather (no webhook changes needed)

### P2 -- Vercel env vars for Telegram bots

If not already done: create 6 BotFather tokens, set all 7 Telegram env vars + `CRON_SECRET` + `OPS_FEED_CHAT_ID` in Vercel. Register webhooks via `scripts/set-webhooks.mjs`. Without these, bots and the stale-digest cron are inoperative. The DB tables now exist (0004 telegram_users, 0007 purchaser role) so the schema side is unblocked.

### P3 -- Stripe Issuing test-mode activation

The code is on main in TEST mode (`LIVEMODE_ALLOWED=false`). The DB tables now exist (0008 issuing_governance). To activate the test-mode flow:
1. Set `STRIPE_SECRET_KEY` (use a restricted test key `rk_test_*`), `STRIPE_WEBHOOK_SECRET` in Vercel
2. Deploy the `worker/` directory to Fly.io with `rk_test_*` + Anthropic key + `role:worker` JWT
3. Toggle `agent_config.agent_enabled` in Supabase only after a dry-run

### P2.5 -- GEMINI_API_KEY (needed for photo-match on work bots)

`GEMINI_API_KEY` is required for the AI photo-match flow on work bots (arrived/delivery/purchaser). Get a key from https://aistudio.google.com/app/apikey and set it in Vercel. The feature degrades gracefully if unset (returns an error message, no crash). `ANTHROPIC_API_KEY` is still needed separately for ops-bot NL editing (Tier 2) if desired, but is no longer required for the core bot workflow.

---

## Feature Readiness (post-migration assessment, 2026-06-11)

With migrations 0004--0012 applied (per Nahom), the schema-level blockers are cleared. Here is the readiness state of each feature area:

| Feature | Schema Ready? | Env Vars Ready? | Functional? | Notes |
|---------|--------------|-----------------|-------------|-------|
| **Storefront** (homepage `/`, `/shoe/[id]`) | YES | YES (no extra vars needed) | YES | Ink/cream/orange design, birr prices, video pipeline all functional. `price_etb` and `video_url` columns exist (0012). |
| **Admin dashboard** (filter bar + shoe_events timeline) | YES | YES | YES | `shoe_events` table exists (0010). Audit timeline populates as status changes occur. Historical events from before migration are absent (expected). |
| **Per-size logistics** (shoe_sizes) | YES | YES | YES | `shoe_sizes` table exists (0005). Old `shoes.logistics_status` column dropped. Admin/shipper per-size management works. |
| **Telegram bots** (6 bots) | YES | **UNCONFIRMED** | **GATED on env vars** | `telegram_users` table exists (0004). Purchaser role + max-2 cap exists (0007). But all 6 bot tokens + webhook secret + OPS_FEED_CHAT_ID + CRON_SECRET must be set in Vercel. Without them, webhook endpoint returns 500. |
| **Purchaser bot** (max-2 concurrent purchases) | YES | **UNCONFIRMED** | **GATED on env vars** | DB constraint is live (0007 trigger). Purchaser bot token (`PURCHASER_BOT_TOKEN`) needed in Vercel. |
| **Stripe Issuing webhook** (L2 authorization) | YES | **UNCONFIRMED** | **GATED on env vars** | 6 governance tables exist (0008). `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` needed. Webhook is fail-closed (declines if secret missing). |
| **Agent worker** (Phase 3 autonomous) | YES | **UNCONFIRMED** | **GATED on env vars + Fly.io deploy** | RLS policies exist (0009). Worker directory needs Fly.io deployment + env vars. `agent_config.agent_enabled` defaults to false. |
| **Ops-bot site editing** (Tier 1 structured) | YES | YES (no extra vars for Tier 1) | YES | `site_copy` table exists (0011). Structured commands work immediately. |
| **Ops-bot NL editing** (Tier 2) | YES | **UNCONFIRMED** | **GATED on env vars** | Needs `ANTHROPIC_API_KEY` + `SITE_EDIT_NL_ENABLED=true`. |
| **Shipper photo-match** (work bots) | YES | **GATED on `GEMINI_API_KEY`** | **GATED on env vars + merge** | Needs `GEMINI_API_KEY` + bot tokens. Uses Gemini `gemini-2.5-flash` via `@google/genai`. Code on PR #35 (`feat/shipper-confirm-receipt`) — CI green, mergeable, design confirmed (decision #16). |
| **Chapa payments** (test-mode POC) | YES | **UNCONFIRMED** | **GATED on env vars** | Payment tables exist (0006). `CHAPA_SECRET_KEY` needed. |
| **Shoe-videos storage bucket** | YES (0012) | N/A | **NEEDS MANUAL CHECK** | The bucket creation SQL ran. If the storage policy failed due to Supabase ownership restrictions (see 0012 header caveat), the bucket exists but public-read policy may be missing. Check in Supabase Storage dashboard. |

**Summary:** Schema is fully unblocked. The next activation bottleneck is **env vars in Vercel** (Telegram bots are highest priority -- they enable the ops workflow). The storefront, admin dashboard, per-size logistics, shoe_events audit trail, and Tier 1 site editing are all immediately functional with no further action.

---

## Decisions -- RESOLVED (carried forward)

1. "remove dispatched" = remove from workflow entirely. Logistics flow: `in_cart -> purchased -> arrived -> delivered`. LIVE.
2. Existing `dispatched` rows remapped to `purchased` (migration 0003). Verified clean 2026-06-02.
3. Stale threshold = 7 days.
4. Stale surfacing = dashboard banner + periodic digest (Vercel Cron, Telegram).
5. Digest channel = Telegram (ops bot).
6. Telegram bots plan = approved. 6 bots, grammY + Vercel webhooks.
7. Brand name = Berebaso / spelling confirmed correct.
8. CTA Amharic = "reserve/hold".
9. Per-size logistics model = approved and live (Phase 1 + Phase 2).
10. Purchaser role with max-2 concurrent cap = approved and live.
11. Stripe Issuing governance rails = approved for TEST mode. L1 spending controls ($300/auth, $2k/day, $5k/month, shoe_stores MCC).
12. Autonomous agent worker = approved for TEST mode. `LIVEMODE_ALLOWED=false`, `dryRun=true`, Fly.io `count=1`.
13. Migration CI = approved. Auto-apply additive, human-gate destructive.
14. Storefront redesign = APPROVED and MERGED (PR #34, 2026-06-11). Ink/cream/orange tokens, bilingual, category card titles, `/shoe/[id]` details page, USD fully redacted from customers, admin-set birr prices, hands-on video pipeline.
15. Shipper receipt confirmation = two options: (a) quick-action buttons on web admin dashboard, (b) AI photo-matching via Telegram work bots. Both built on `feat/shipper-confirm-receipt`. No enum changes, no new migrations.
16. Distributor delivery-confirmation design (PR #35) — ALL 4 blocking questions answered by Nahom (2026-06-13), all match defaults as built, NO code changes required:
    - (a) Distributor role = existing **shipper** role. No new DB role.
    - (b) One photo = one shoe (top-3 candidates, pick one). No multi-shoe-per-photo.
    - (c) On confirmation, advance **all eligible sizes** of the matched shoe (no per-size selector).
    - (d) Confirmation UX = **inline buttons** (tap to confirm).

---

## Real-money stack safety posture

PRs #29 and #30 introduced the Stripe Issuing + autonomous agent stack. Key safety properties on main:
- `LIVEMODE_ALLOWED=false` hardcoded in worker
- `dryRun=true` default in browser adapter
- `agent_config.agent_enabled` defaults to `false` in migration 0008
- Worker cannot self-approve POs (RLS: INSERT on purchase_orders WITH CHECK status='draft')
- L1 spending controls: $300/auth, $2k/day, $5k/month, shoe_stores MCC only
- L2 authorization webhook: sig-verify fail-closed (DECLINE), single indexed query with optimistic PO guard
- PAN never stored (Stripe Issuing ephemeral retrieval only)
- Fly.io `count=1` prevents duplicate POs

---

## Build/verify reminders (this env)

Linux node is broken (glibc 2.27). Use Windows `node.exe` / npm-cli.js / `git.exe` / `gh.exe` (authed as NahomX). Migrations are run by the USER in Supabase SQL Editor (or via migration CI once wired) -- the PM hands over the SQL, never claims it's applied.

---

## Local repo state

- Current branch: `feat/shipper-confirm-receipt` (based on main `f090cd6`)
- `origin/main` tip: `f090cd6` (PR #34 merge commit, 2026-06-11)
- PR #35: OPEN, CI green, MERGEABLE, design confirmed (decision #16)
- Build + lint: GREEN (8/8 pages, no ESLint warnings)
- Ready for: MERGE (user approval)

---

## Changelog

- v20 -- 2026-06-13 -- pm-sole-supply -- PR #35 photo-match provider swapped from Claude (Anthropic SDK) to Gemini (`gemini-2.5-flash` via `@google/genai`). `GEMINI_API_KEY` replaces `ANTHROPIC_API_KEY` for shoe-matcher; `ANTHROPIC_API_KEY` still needed only for NL editing. `.env.example` updated. Build+lint green. P2.5 rewritten. Compare-and-swap v19->v20 (N_start=N_disk=19).
- v19 -- 2026-06-13 -- pm-sole-supply -- PR #35 design confirmed: all 4 blocking questions answered by Nahom, all match defaults as built (no code changes). Locked decision #16 (shipper=existing role, 1-photo-1-shoe, advance-all-sizes, inline-buttons). PR #35 state: OPEN, Vercel CI SUCCESS, MERGEABLE, awaiting user merge approval. Compare-and-swap v18->v19 (N_start=N_disk=18).
- v18 -- 2026-06-13 -- pm-sole-supply -- feat/shipper-confirm-receipt branch built (lint+build green). Two features: (1) Shipper quick-action UI — per-size one-tap buttons (Arrived/Delivered/Purchased) replacing dropdown for shippers, batch "Mark all" button with confirm, admin dropdown de-emphasised; (2) AI photo-matching via Telegram — `lib/shoe-matcher.ts` (Claude claude-sonnet-4-20250514 vision, 8-candidate cap, 30s timeout) + `message:photo` handler on all work bots (purchaser/arrived/delivery) with `phm:{shoeId}` / `phm_no` inline confirmation. No enum changes, no new migrations. ANTHROPIC_API_KEY elevated from P4 to P2.5 (now needed for core bot workflow). Decision #15 recorded. Compare-and-swap v17->v18 (N_start=N_disk=17).
- v17 -- 2026-06-11 -- pm-sole-supply -- MIGRATION MILESTONE: Nahom applied migrations 0004-0012 in Supabase SQL Editor. Updated all 9 migrations from UNCONFIRMED to "applied per Nahom, unverified" (no DATABASE_URL available for migrate:check verification). Added Feature Readiness table assessing all feature areas post-migration. Schema fully unblocked; next bottleneck is Vercel env vars (P2 Telegram bots highest priority). Reprioritized user actions: former P0 (migration) resolved, new P0 is migration CI baseline, P1 is storefront content (store address/phone/Telegram handle). Compare-and-swap v16->v17 (N_start=N_disk=16).
- v16 -- 2026-06-11 -- pm-sole-supply -- PR #34 (feat/storefront-redesign) MERGED. Post-PR review passed: redaction intact (url + price_usd stripped for non-admins on / and /shoe/[id]), enum sync untouched (no enum changes), build green (8/8 pages), Vercel CI SUCCESS. Merged via gh.exe (commit f090cd6). Updated main tip, moved PR #34 from OPEN to merged history, migration 0012 now on main (still unconfirmed). Flagged migrations 0007-0010 as HIGH per Jackson's daily check-in. Reprioritized user actions. Compare-and-swap v15->v16 (N_start=N_disk=15).
- v15 -- 2026-06-09 -- pm-sole-supply -- PR #34 (feat/storefront-redesign) OPEN. Storefront redesign approved. Added PR #34 details, post-merge user actions, migration 0012 to unconfirmed list (0004--0012). Resolved PENDING DESIGN DECISION. Added decision #14. Updated local repo state. Compare-and-swap v14->v15 (N_start=N_disk=14).
- v14 -- 2026-06-09 -- pm-sole-supply -- FULL REWRITE. STATUS was 7 versions / 6 days stale (v13 said "SEVEN PRs OPEN" -- reality: 0 open, 33 closed/merged, main at 533241b). Rewritten from scratch against GitHub truth (gh.exe pr list --state all). Documented: all 33 PRs merged/closed, 11 migrations on main (0001-0011, application status: 0001-0003 confirmed, 0004-0011 unconfirmed), all env var posture (unconfirmed), real-money stack safety posture (PRs #29/#30), migration CI setup requirements (PR #24: DATABASE_URL secret + production env + baseline), storefront redesign proposal at docs/presentation/ logged as PENDING DESIGN DECISION. Prioritized outstanding user actions (P0 migrations, P1 bot env vars, P2 Stripe test activation, P3 redesign decision). Compare-and-swap v13->v14 (N_start=N_disk=13).
- v13 -- 2026-06-03 -- pm-sole-supply -- PR #16 (feat/per-size-status-p1). [SUPERSEDED by v14 rewrite]
- v12 -- 2026-06-02 -- pm-sole-supply -- PR #15 legibility fix.
- v11 -- 2026-06-02 -- pm-sole-supply -- PR #15 (feat/size-availability).
- v10 -- 2026-06-02 -- pm-sole-supply -- PR #13 UX/UI review fixes.
- v9 -- 2026-06-02 -- pm-sole-supply -- PR #13 (feat/berebaso-rebrand).
- v8 -- 2026-06-02 -- pm-sole-supply -- PR #12 reliability fix.
- v7 -- 2026-06-02 -- pm-sole-supply -- PR C (#12) ops feed.
- v6 -- 2026-06-02 -- pm-sole-supply -- PR B (#11).
- v5 -- 2026-06-02 -- pm-sole-supply -- PR A (#10) Telegram bots.
- v4 -- 2026-06-02 -- pm-sole-supply -- PR #8 marked MERGED, M2 live.
- v3 -- 2026-05-31 -- pm-sole-supply -- M1+M2+M3 shipped.
- v2 -- 2026-05-31 -- pm-sole-supply -- Scoping decisions locked.
- v1 -- 2026-05-31 -- pm-sole-supply -- Project onboarded.
