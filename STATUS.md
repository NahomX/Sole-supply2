# Sole Supply — STATUS

**Version:** 4
**Last updated:** 2026-06-02 (pm-sole-supply — doc-reconcile: PR #8 merged, migration confirmed live, PR #9 blocker updated)
**State:** ONE PR OPEN (#9 feat/stale-checker). M2 + M3 are fully live (PR #8 merged to main at bd47541; 0003 migration confirmed run in Supabase). PR #9 is blocked solely on Telegram env vars (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) not yet set in Vercel — and user confirming Vercel plan supports Cron — before merging.

**Owner:** `pm-sole-supply` (sole writer of this file). **Repo:** `NahomX/Sole-supply2` (public). **Local:** `/mnt/c/Users/Nahom/Documents/claude-sandbox/sole-supply/`.

---

## Product in one paragraph

A Next.js 14 + Supabase web app for a **sneaker-importing workflow, US → Addis Ababa**. It is a procurement queue + storefront preview + interest tracker + logistics pipeline (no automated checkout — a human buys each shoe). Roles: **customer** (browse `/`, tap "I want this"), **submitter** (paste retailer URLs at `/submit`, OG-scraped), **shipper** (flip logistics status in `/admin`), **admin** (everything). Deployed on Vercel; auth via Supabase magic links; RLS on.

## The data model — two status tracks (locked)

Each `shoes` row carries two independent tracks:
- **Sales status** `shoes.status` (admin): `upcoming → available → sold`
- **Logistics status** `shoes.logistics_status` (nullable; admin/shipper): `in_cart → purchased → arrived → delivered`
  - (was `purchased → dispatched → arrived → delivered` before M2; dispatched removed, in_cart added — LIVE as of 2026-06-01)

Each enum is mirrored in **four places that must stay in sync**: the DB check constraint (`supabase/migrations/`), the TS type (`lib/supabase.ts`), the API validation array (`app/api/shoes/[id]/route.ts`), and the admin dropdown array (`app/admin/AdminDashboard.tsx`).

---

## OPEN PRs

### PR #9 — `feat/stale-checker` (M1)
**URL:** https://github.com/NahomX/Sole-supply2/pull/9

**What's in it:**
- `lib/staleness.ts`: `isStale()` + `staleAgeDays()` helpers, 7-day threshold
- Admin dashboard: amber attention banner (clickable stale filter) + "Stale · Nd" badge per stale row
- `app/api/cron/stale-digest/route.ts`: Telegram digest cron route, guarded by `CRON_SECRET`
- `vercel.json`: Vercel Cron entry `0 8 * * *` → `/api/cron/stale-digest`
- `.env.example`: documents new env vars

**Remaining blocker (as of 2026-06-02):**
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are NOT yet set in Vercel. User must add these in Vercel Dashboard → Project → Settings → Environment Variables.
- `CRON_SECRET` also needs to be set (see table below).
- User must confirm Vercel plan supports Cron (Pro or Hobby with limits).

Once all three vars are set and Cron confirmed, merge PR #9.

**Verify gate:** `npm run lint` + `npm run build` green on branch (already confirmed).

---

## MERGED PRs

### PR #8 — `feat/logistics-in-cart-and-ui` (M2 + M3) — MERGED 2026-06-01 17:35 UTC
**Merge commit:** `bd47541` → `main`
**URL:** https://github.com/NahomX/Sole-supply2/pull/8

**What landed:**
- M2: logistics enum change (`in_cart` replaces `dispatched`) across all four sync points — LIVE on main
- M3: customer-facing friendly labels (`lib/labels.ts`), sectioned homepage grid, badge revision — LIVE on main
- DB migration `0003_logistics_in_cart.sql` confirmed run in Supabase by user (2026-06-02). No orphaned `dispatched` rows. M2 fully live in both code and DB.

---

## Vercel env vars to set (for M1 / PR #9)

| Variable | What it is | How to get it |
|---|---|---|
| `CRON_SECRET` | Shared secret protecting `/api/cron/stale-digest` | Generate: `openssl rand -hex 32` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | @BotFather on Telegram |
| `TELEGRAM_CHAT_ID` | Destination chat/channel ID | `https://api.telegram.org/bot<TOKEN>/getUpdates` after sending a message to the bot |

Set in Vercel Dashboard → Project → Settings → Environment Variables. Vercel Cron automatically injects `CRON_SECRET` as `Authorization: Bearer <value>` on each invocation.

---

## Decisions — RESOLVED (user, 2026-05-31)

1. ✅ **"remove dispatched"** = remove the status from the workflow entirely. → M2 flow is `in_cart → purchased → arrived → delivered`. LIVE.
2. ✅ **Existing `dispatched` rows** → remap to **`purchased`** (conservative). Encoded in 0003 migration before constraint reseat. Verified clean (confirmed 2026-06-02).
3. ✅ **Stale threshold** = **7 days**.
4. ✅ **Stale surfacing** = **dashboard + periodic digest** (Vercel Cron, Telegram).
5. ✅ **Digest channel** = **Telegram** (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`).

---

## Build/verify reminders (this env)

Linux node is broken (glibc 2.27). Use Windows `node.exe` / npm-cli.js / `git.exe` / `gh.exe` (authed as NahomX). Migrations are run by the USER in Supabase SQL Editor — the PM hands over the SQL, never claims it's applied.

Note: `package-lock.json` + `.eslintrc.json` were generated and committed as part of the M2/M3 build pass (they were missing from the repo; both landed on main via PR #8).

---

## Changelog

- v4 — 2026-06-02 — pm-sole-supply — Doc-reconcile only. PR #8 (feat/logistics-in-cart-and-ui) marked MERGED (bd47541, 2026-06-01 17:35 UTC). Migration 0003_logistics_in_cart.sql confirmed run in Supabase by user (2026-06-02), no orphaned dispatched rows — M2 fully live. PR #9 (feat/stale-checker) remains open; blocker updated to: Telegram vars (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) not yet set in Vercel, plus CRON_SECRET and Vercel plan Cron confirmation. No code changes. Compare-and-swap v3→v4 (N_start=N_disk=3).
- v3 — 2026-05-31 — pm-sole-supply — Built and shipped M1+M2+M3 to two PRs. PR #8 (feat/logistics-in-cart-and-ui): M2 enum change (in_cart/dispatched) + M3 customer labels. PR #9 (feat/stale-checker): M1 dashboard banner + Telegram cron digest. Both lint+build green. Migration SQL handed to user. Vercel env vars documented. Compare-and-swap v2→v3 (N_start=N_disk=2).
- v2 — 2026-05-31 — pm-sole-supply — Locked the 4 scoping decisions from the user: (1) remove `dispatched` entirely; (2) remap existing `dispatched` rows → `purchased` (encoded in 0003 before constraint reseat); (3) stale threshold = 7 days; (4) stale surfacing = dashboard **+ periodic digest**. M1 expanded with part B (Vercel-Cron `/api/cron/stale-digest` route + `vercel.json` + `CRON_SECRET`); one small open item remains = digest channel (Telegram proposed vs. email). M2/M3 unchanged in shape, now LOCKED. Compare-and-swap v1→v2 (N_start=N_disk=1).
- v1 — 2026-05-31 — pm-sole-supply (created by agent-jackson) — Project onboarded into the sandbox: repo `NahomX/Sole-supply2` cloned to `sole-supply/`, codebase studied (Next.js 14 + Supabase, two-status-track model documented). Next phase scoped into M1 (stale-listing checker), M2 (logistics enum: add `in_cart`, remove `dispatched`), M3 (customer-facing UI revision + label-mapping spec). Three load-bearing decisions flagged for user confirmation before M2/M1 lock. Nothing built yet — scope only.
