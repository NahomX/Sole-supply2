# Sole Supply — STATUS

**Version:** 17
**Last updated:** 2026-06-04 (pm-sole-supply — PR #22 feat/issuing-rails: Phase 2 Stripe Issuing governance rails TEST mode)
**State:** ELEVEN PRs OPEN: #9 (feat/stale-checker, blocked on Vercel env vars), #10 PR A (feat/telegram-bots), #11 PR B (feat/telegram-bots-work), #12 PR C (feat/ops-feed, stacked on PR B), #13 (feat/berebaso-rebrand, stacked on PR C), #15 (feat/size-availability, branched from main 408823a — independent), #16 (feat/per-size-status-p1, branched from origin/main 2f8d8f3 — independent), #18 (feat/per-size-status-p2, stacked on #16 — merge #16 first), #20 (feat/payments-poc, branched from origin/main 94c49c0 — independent), #21 (feat/purchaser-role, branched from origin/main 94c49c0 — independent), #22 (feat/issuing-rails, stacked on #21 — merge #21 first). Merge order for bots stack: #10 → #11 → #12 → #13; PR #9 and #15 independent; PR #16 then PR #18 (per-size pipeline); PR #20 independent (requires 0006 migration + Chapa env vars); PR #21 then PR #22 (Stripe Issuing stack). PR #16 requires user to run migration 0005 in Supabase after merge; PR #22 requires user to run migration 0008 in Supabase after merge.

**Owner:** `pm-sole-supply` (sole writer of this file). **Repo:** `NahomX/Sole-supply2` (public). **Local:** `/mnt/c/Users/Nahom/Documents/claude-sandbox/sole-supply/`.

---

## Product in one paragraph

A Next.js 14 + Supabase web app for a **sneaker-importing workflow, US → Addis Ababa**. It is a procurement queue + storefront preview + interest tracker + logistics pipeline (no automated checkout — a human buys each shoe). Roles: **customer** (browse `/`, tap "I want this"), **submitter** (paste retailer URLs at `/submit`, OG-scraped), **shipper** (flip logistics status in `/admin`), **admin** (everything). Deployed on Vercel; auth via Supabase magic links; RLS on. **Interactive Telegram bots** (grammY, webhook-based) are being added in two PRs.

## The data model — two status tracks (locked)

Each `shoes` row carries two independent tracks:
- **Sales status** `shoes.status` (admin): `upcoming → available → sold`
- **Logistics status** `shoes.logistics_status` (nullable; admin/shipper): `in_cart → purchased → arrived → delivered`
  - (was `purchased → dispatched → arrived → delivered` before M2; dispatched removed, in_cart added — LIVE as of 2026-06-01)

Each enum is mirrored in **four places that must stay in sync**: the DB check constraint (`supabase/migrations/`), the TS type (`lib/supabase.ts`), the API validation array (`lib/shoes.ts` — now the canonical source, imported by the API route), and the admin dropdown array (`app/admin/AdminDashboard.tsx`).

---

## OPEN PRs

### PR A (#10) — `feat/telegram-bots` — Telegram bots infra + customer bot
**URL:** https://github.com/NahomX/Sole-supply2/pull/10
**Branch:** `feat/telegram-bots` (branched from `origin/main` at `bd47541`)

**What's in it:**
- `lib/shoes.ts` (new): extracted `createShoeFromUrl`, `setLogisticsStatus`, `setSalesStatus`, `getPublicShoes`, `getAllShoes`, `getShoesByLogistics`; canonical `STATUSES`/`LOGISTICS` arrays (single source of truth, replaces inline arrays in the API route)
- `app/api/shoes/route.ts`: delegates to `lib/shoes.createShoeFromUrl` (no logic change)
- `app/api/shoes/[id]/route.ts`: imports `STATUSES`/`LOGISTICS` from `lib/shoes` (no logic change)
- `lib/telegram.ts` (new): `sendTelegramMessage` helper + `verifyWebhookSecret`
- `lib/bots/registry.ts` (new): `BOT_REGISTRY` — 6 entries (customer, incart, purchaser, arrived, delivery, ops); `getBotEntry` lookup
- `lib/bots/auth.ts` (new): `checkAllowlist` — queries `telegram_users` table, enforces role + per-bot scoping
- `lib/bots/handlers.ts` (new): grammY handlers for all 6 bots; customer bot NEVER emits `shoe.url` (producer-URL redaction boundary)
- `app/api/telegram/[bot]/route.ts` (new): dynamic webhook dispatcher; verifies `X-Telegram-Bot-Api-Secret-Token`
- `supabase/migrations/0004_telegram_users.sql` (new): allowlist table — NOT yet applied; user must run in Supabase SQL Editor
- `package.json`: add `grammy ^1.31.0`
- `package-lock.json`: regenerated with grammy
- `.env.example`: documents all 7 new env vars

**Build gate:** `npm ci` + `npm run lint` + `next build` all green (verified in throwaway worktree).

**Remaining user actions for PR A:**
- Merge PR A
- Run `supabase/migrations/0004_telegram_users.sql` in Supabase SQL Editor
- Create 6 BotFather bot tokens (customer, incart, purchaser, arrived, delivery, ops)
- Set `TELEGRAM_WEBHOOK_SECRET` + all 6 tokens as Vercel env vars
- Register webhooks via `scripts/set-webhooks.mjs` (PR B will add this script)

### PR B (#11) — `feat/telegram-bots-work` — Work bots + ops bot + stale-digest repoint
**URL:** https://github.com/NahomX/Sole-supply2/pull/11
**Branch:** `feat/telegram-bots-work` (branched from `feat/telegram-bots`)
**Merge after:** PR A (#10)

**What's in it:**
- `scripts/set-webhooks.mjs` (new): register/clear/inspect webhooks for all 6 bots
- `lib/staleness.ts` (new): `isStale()` + `staleAgeDays()` helpers (identical to feat/stale-checker content)
- `app/api/cron/stale-digest/route.ts` (new): stale digest repointed to `OPS_BOT_TOKEN`; uses `lib/telegram.sendTelegramMessage`
- `vercel.json` (new): Vercel Cron entry for stale-digest

**Note:** Work bot + ops bot handlers are already in `lib/bots/handlers.ts` (PR A). No additional code.

**Merge conflict notes:** If PR #9 merges before PR B, conflicts on `lib/staleness.ts`, `app/api/cron/stale-digest/route.ts`, `vercel.json`. Keep PR B's version of the digest route. `AdminDashboard.tsx` from PR #9 merges cleanly.

---

### PR C (#12) — `feat/ops-feed` — Shared ops feed (stacked on PR B)
**URL:** https://github.com/NahomX/Sole-supply2/pull/12
**Branch:** `feat/ops-feed` (branched from `feat/telegram-bots-work`)
**Merge after:** PR B (#11)

**What's in it:**
- `lib/shoes.ts`: new `FeedMeta` type + `postOpsFeed` (fire-and-forget) + `buildFeedSuffix` helpers. `setLogisticsStatus`, `setSalesStatus`, and `createShoeFromUrl` each accept an optional `meta?: FeedMeta` param and post to the feed on a real status change. `createShoeFromUrl` posts only when `logistics_status === 'in_cart'`. Duplicate/no-op posts suppressed by comparing current DB value before writing.
- `app/api/shoes/[id]/route.ts`: migrated from raw Supabase `update()` to calling `setLogisticsStatus` / `setSalesStatus` helpers; passes `{ actorLabel: session.email, source: "web" }`.
- `app/api/shoes/route.ts`: passes `{ actorLabel: session.email, source: "web" }` meta to `createShoeFromUrl`.
- `lib/bots/handlers.ts`: new `botMeta(ctx, botName)` helper builds `FeedMeta` from Telegram `@username`/first_name + bot entry name; all bot calls to `createShoeFromUrl`, `setLogisticsStatus`, `setSalesStatus` pass it.
- `.env.example`: documents `OPS_FEED_CHAT_ID` with step-by-step instructions for creating the group, adding the ops bot, and reading the negative group chat ID from `getUpdates`.

**New env var required:** `OPS_FEED_CHAT_ID` (negative integer; see `.env.example`). Pairs with existing `OPS_BOT_TOKEN`. Feature silently no-ops if either var is unset.

**Build gate:** `npm ci` + `npm run lint` + `next build` all green (verified in throwaway worktree, commit 27e99ec — await+timeout fix).

**Remaining user actions for PR C:**
- Merge PRs #10, #11 first, then merge #12.
- Create a private Telegram group (e.g. "Sole Supply Ops"), add the ops bot, send any message, read the chat ID from `getUpdates`, set `OPS_FEED_CHAT_ID` in Vercel. (Details below and in `.env.example`.)

---

### PR #13 — `feat/berebaso-rebrand` — Rebrand + bilingual UI + visual hero + bot onboarding (stacked on PR C)
**URL:** https://github.com/NahomX/Sole-supply2/pull/13
**Branch:** `feat/berebaso-rebrand` (branched from `feat/ops-feed`)
**Merge after:** PR C (#12)

**What's in it:**
- **Area 1 — Rename Sole Supply → Berebaso**: `README.md` title, `package.json` name, `app/layout.tsx` (HTML title/header/footer), `app/page.tsx` hero, `lib/bots/handlers.ts` (customer + ops bot welcome messages), `app/api/cron/stale-digest/route.ts` digest prefix, `.env.example` comments. GitHub repo/dir/tables/identifiers unchanged.
- **Area 2 — Bilingual EN/Amharic storefront**: Bilingual header logo lockup (Latin + Amharic "በረባሶ"). Hero bilingual lockup (Amharic dominant). Section headings with Amharic subtitles (`አሁን ዝግጁ`, `በመንገድ ላይ`, `በቅርቡ ይመጣል`, `ቀደም ሲል የነበሩ`). "I want this" CTA → Amharic `ይሄን እፈልጋለሁ`. Noto Sans Ethiopic / Abyssinica SIL / Nyala font stack on all Amharic nodes + in `tailwind.config.ts`. `lang="am"` attributes. Line-height 1.4–1.45 for Geez glyphs.
- **Area 3 — Visual hero + Tailwind polish**: CSS-gradient hero band (espresso→coffee→amber, `rounded-2xl`, radial-dot texture, zero external image/CLS). Brand palette in tailwind.config.ts (`brand.espresso/coffee/amber/green/gold`). Section amber accent bar. `ShoeCard.tsx`: `rounded-xl`, `shadow-sm`, hover lift + image zoom (GPU-only transforms). Empty-state card with inline SVG sneaker icon. Spacing rhythm upgrade. "In stock" badge → brand green #1F7A52.
- **Area 4 — Bot onboarding**: `guardAllowlist` now includes user's Telegram ID in the denial reply. `/whoami` added to all work bots (purchaser/arrived/delivery). `README.md` gets "Logistics flow" section documenting the bot pipeline.

**Build gate:** `npm ci` + `npm run lint` + `next build` all green (verified in-directory, commits `52685d1` and `fb731ec`).

**CONFIRMED by owner (native speaker) — no action needed:**
- Brand spelling "በረባሶ" is correct — alternatives removed from code comments.
- CTA Amharic changed from `ይሄን እፈልጋለሁ` to `ይያዙ` ("reserve/hold"); `aria-label` + `title` updated to "Reserve".

**USER must verify before launch:**
- Remaining Amharic copy still needs native-speaker review: hero tagline `ከአሜሪካ የመጡ አዳዲስ ጫማዎች፣ በቀጥታ ወደ አዲስ አበባ` and the four section subtitles (`አሁን ዝግጁ`, `በመንገድ ላይ`, `በቅርቡ ይመጣል`, `ቀደም ሲል የነበሩ`).
- Test Amharic rendering on iOS and older Android — Noto Sans Ethiopic is now loaded via next/font/google so tofu should not appear, but end-to-end device testing is needed.
- No new env vars required.

**UX/UI review fixes applied (commit fb731ec):**
- P0 Noto Sans Ethiopic webfont loaded via next/font/google (--font-ethiopic CSS var); all Amharic fontFamily inline styles updated to var(--font-ethiopic).
- P0 ShoeCard onError fallback — dead image URLs show sneaker-SVG empty state. remotePatterns left permissive (hostname: "**") — arbitrary retailer hosts are by design.
- P1 Hero dark scrim (rgba 0,0,0 0.45→0) behind text column; supporting text bumped to text-white/90.
- P1 Duplicate id="in-stock" removed (standalone phantom div gone); scroll-mt-24 on actual <section>; hero CTA anchors to first non-empty section.
- P2 Badge palette: "On the way" → gold #E8B53A + dark text; "Coming soon" → espresso #2A1A12. Palette closed.
- P2 JS onMouseOver/onMouseOut hover replaced with Tailwind bg-brand-espresso hover:bg-brand-coffee + focus-visible outline. Keyboard a11y regression fixed.
- P2 Action buttons py-2.5 + items-stretch → ~44px tap targets + equal height.
- P2 Footer bilingual: "Berebaso በረባሶ · Addis Ababa, Ethiopia".

---

### PR #16 — `feat/per-size-status-p1` — Per-size logistics status (Phase 1)
**URL:** https://github.com/NahomX/Sole-supply2/pull/16
**Branch:** `feat/per-size-status-p1` (branched from `origin/main` at `2f8d8f3`)
**Independent** — not stacked on any other open PR; can merge any time.

**What's in it:**
- `supabase/migrations/0005_shoe_sizes.sql` (new): create `shoe_sizes` table (one row per shoe×size, nullable per-size `logistics_status` with 4-value check, unique(shoe_id, us_size), index, RLS + public-read policy). Backfill by parsing `shoes.sizes` free-text into rows (each inheriting `shoes.logistics_status`). Then DROP `shoes.logistics_status`. Idempotent. USER must run in Supabase.
- `lib/supabase.ts`: add `ShoeSize` type; drop `logistics_status` from `Shoe`; add optional `shoe_sizes?: ShoeSize[]` join field.
- `lib/shoes.ts`: add `getShoeSizes`, `setSizeStatus`, `addSize`, `removeSize`, `advanceAllSizes` (interim bot), `syncSizesFromText`; rework `getShoesByLogistics` / `getPublicShoes` / `getAllShoes` to join `shoe_sizes`; remove `setLogisticsStatus`.
- `lib/labels.ts`: add `SizeCustomerState`, `sizeLabel`, `shoeSection`; refactor `customerLabel` to aggregate via `shoeSection`.
- `lib/sizes.ts`: add `sizeGridFromSizes` (authoritative, from DB rows); keep `sizeGrid` (legacy text fallback) + `parseAvailableSizes`.
- `lib/staleness.ts`: stale = all sizes null/in_cart (or no sizes) AND >7d old.
- `lib/bots/handlers.ts`: INTERIM — work bots + ops bot use `advanceAllSizes`; `setLogisticsStatus` call sites removed.
- `components/ShoeCard.tsx`: `SizeStrip` driven by `shoe_sizes` rows; in-stock=green, on-the-way=gold, coming-soon=muted, sold-out=greyed+struck; a11y preserved.
- `app/page.tsx`: join `shoe_sizes`; section by `shoeSection()`.
- `app/admin/page.tsx`: join `shoe_sizes` in query.
- `app/admin/AdminDashboard.tsx`: per-size chip editor (shipper: set status; admin: add/remove + set).
- `app/api/shoes/[id]/route.ts`: drop logistics branch; admin-only for sales + scalar fields.
- `app/api/shoes/[id]/sizes/route.ts` (new): GET/POST/DELETE/PATCH per-size endpoint.

**Build gate:** `npm ci` + `npm run lint` + `next build` all green (verified in throwaway worktree, commit `08356aa`).

**USER must do before feature goes live:**
1. Merge PR #16 (or after — the code path is safe pre-migration, falls back to free-text strip).
2. Run `supabase/migrations/0005_shoe_sizes.sql` in Supabase SQL Editor.
3. Verify: `select shoe_id, us_size, logistics_status from shoe_sizes limit 20;` shows backfilled rows.
4. Verify: `select count(*) from information_schema.columns where table_name='shoes' and column_name='logistics_status';` returns 0.

**What's deferred to Phase 2 (separate PR):**
- Now delivered in PR #18.

---

### PR #18 — `feat/per-size-status-p2` — Per-size drill-down bot UX (Phase 2)
**URL:** https://github.com/NahomX/Sole-supply2/pull/18
**Branch:** `feat/per-size-status-p2` (branched from `feat/per-size-status-p1`)
**Stacked on PR #16** — merge PR #16 first, then this one.

**What's in it:**
- `lib/bots/handlers.ts` (one file changed, +393/-84 lines, commit `fd928b8`):
  - **Work bots (purchaser/arrived/delivery):** `/list` shows shoes with ≥1 size at `fromStatus` (one button per shoe, `pick:{shoeId}`). Tap shoe → size toggle keyboard (all eligible sizes, `sz:{shoeId}:{usSize}`). Each tap flips a `✓` prefix in the live keyboard via `editMessageReplyMarkup` — state is encoded IN the keyboard buttons, no grammY session store, serverless-safe. "Advance selected" (`go:{shoeId}`) reads ✓-marked buttons and calls `setSizeStatus` per size. "Advance all" (`szall:{shoeId}`) calls `advanceAllSizes`.
  - **In-cart bot:** after `createShoeFromUrl` succeeds, presents full `SIZE_GRID` as a toggle keyboard. `ic_done:{shoeId}` calls `addSize` + `setSizeStatus(in_cart)` for each selected size. `ic_skip:{shoeId}` dismisses without adding sizes.
  - **Ops bot `/logistics`:** full drill-down — `ops_log_pick:{shoeId}` → `ops_log_sz:{shoeId}:{usSize}` → `ops_log_st:{shoeId}:{usSize}:{status}` (or `"null"` to clear). Replaces interim "advance all" from Phase 1.
  - **`guardAllowlist` re-checked on every callback query**, not just commands.
  - **Customer bot unchanged.**
  - `InlineKeyboardButton` type imported from `@grammyjs/types` (not re-exported directly from `grammy`).

**Callback data scheme (all ≤ 64 bytes):**
- Work bots: `pick:{shoeId}`, `sz:{shoeId}:{usSize}`, `go:{shoeId}`, `szall:{shoeId}`
- In-cart: `ic_sz:{shoeId}:{usSize}`, `ic_done:{shoeId}`, `ic_skip:{shoeId}`
- Ops: `ops_log_pick:{shoeId}`, `ops_log_sz:{shoeId}:{usSize}`, `ops_log_st:{shoeId}:{usSize}:{status}`
- Sales (unchanged): `ops_sales_pick:{shoeId}`, `ops_sales_set:{shoeId}:{status}`

**Build gate:** `npm ci` + `npm run lint` + `next build` all green (verified in throwaway worktree, commit `fd928b8`). Worktree cleaned up.

**Note:** Live bot testing requires owner to set tokens/webhooks (not yet configured) — verify via build + logic review, not a live run.

---

### PR #15 — `feat/size-availability` — Size availability grid on shoe cards
**URL:** https://github.com/NahomX/Sole-supply2/pull/15
**Branch:** `feat/size-availability` (branched from `origin/main` at `408823a`)
**Independent** — not stacked on any other open PR; can merge any time after build review.

**What's in it:**
- `lib/sizes.ts` (new): canonical Men's US 7–13 ↔ EU size table (EU approximate, noted in code); `parseAvailableSizes(sizesText)` — lenient free-text parser handles comma/space/slash/semicolon/pipe separators, integer ranges ("8-12" → 8…12), explicit half-sizes ("8.5"), "US"/"EU" label stripping, EU-to-US reverse lookup, stray quotes; `sizeGrid(sizesText)` returns full 13-entry `{ us, eu, available }` array.
- `components/ShoeCard.tsx`: new `SizeStrip` component renders a compact `flex-wrap` chip row below the shoe title. Available chips: `bg-neutral-100 text-neutral-700`. Unavailable chips: `bg-neutral-50 text-neutral-300` + `line-through` on the US text + `aria-label="US X / EU Y — sold out"` + `title` attribute. Bilingual label "Sizes · መጠን" using `--font-ethiopic` var. Empty-state: null/blank `sizes` → strip omitted entirely; text present but nothing maps to US grid → "Sizes TBA / መጠን በቅርቡ". Reserve/request flow is completely unchanged.
- No schema change. No new env vars. No migration needed.

**Build gate:** `npm ci` + `npm run lint` + `next build` all green (verified in throwaway worktree, commit `3aa4959`). Legibility fix also verified green (commit `7738e7e`).

**Legibility fix (commit `7738e7e`):** SizeStrip chip styling bumped for readability — US `text-[9px]` → `text-[11px]`, EU `text-[8px]` → `text-[9px]`, available EU `text-neutral-400` → `text-neutral-500`, sold-out US container `text-neutral-300` → `text-neutral-400`, sold-out EU `text-neutral-200` → `text-neutral-300`, chip padding `px-1` → `px-1.5`. `flex-wrap gap-0.5` and all aria/label/TBA behavior preserved.

**USER actions before merge:**
- Visual QA on a real device (phone, 375 px viewport): verify chips wrap cleanly on 2-up card layout and are legibly sized.
- Functional test: shoe with `sizes = "9, 10, 11"` → chips 9, 10, 11 solid; rest greyed. Shoe with `sizes = "8-12"` → 8–12 solid. Shoe with `sizes = null` → no strip. Shoe with garbled text → TBA notice.
- Screen reader spot-check: sold-out chip should announce "US X / EU Y — sold out".

---

### PR #20 — `feat/payments-poc` — Chapa payment integration (admin-only test-mode POC)
**URL:** https://github.com/NahomX/Sole-supply2/pull/20
**Branch:** `feat/payments-poc` (branched from `origin/main` at `94c49c0`)
**Independent** — not stacked on any other open PR; can merge any time after owner sets up Chapa.

**What's in it:**
- `supabase/migrations/0006_payments.sql` (new): `payments` table. Columns: `id uuid PK`, `shoe_id uuid null FK→shoes`, `size text`, `amount numeric`, `currency text default 'ETB'`, `tx_ref text unique`, `status text check(pending/paid/failed) default pending`, `chapa_ref text`, `customer_email text`, `created_at`, `updated_at`. RLS on; NO public/authenticated policies — service-role only. `updated_at` auto-maintained via trigger. Idempotent.
- `lib/payments.ts` (new, server-only): `initChapa({shoeId,size,amount,email})` (insert pending row + unique tx_ref `ss-<ts>-<rand>` → POST Chapa initialize → return `checkout_url`); `verifyChapa(tx_ref)` (GET Chapa verify — source of truth → update paid/failed → ops-feed post "💳 test payment {tx_ref} — {status}"); `verifyChapaWebhookSig(sigHeader,rawBody)` (HMAC-SHA256 fail-closed). Uses `supabaseService()` + `sendTelegramMessage`. Mirrors `lib/shoes.ts`/`lib/telegram.ts` patterns.
- `app/api/admin/test-payment/route.ts` (new, POST): `PAYMENTS_POC_ENABLED==="true"` flag check + `requireRole(["admin"])` → `initChapa` → `{checkout_url, tx_ref}`.
- `app/api/webhooks/chapa/route.ts` (new, POST): read raw body → `verifyChapaWebhookSig()` (fail-closed, 403 on bad/missing sig) → `verifyChapa(tx_ref)` → 200. Never trusts webhook body status.
- `lib/supabase.ts`: added `PaymentStatus` + `Payment` types.
- `app/admin/page.tsx`: loads `recentPayments` (last 20) for admin when `paymentsEnabled`; passes to `AdminDashboard`.
- `app/admin/AdminDashboard.tsx`: new admin-only "Payments (test)" tab (hidden unless `paymentsEnabled`): form (shoe/size/amount ETB/email → POST `/api/admin/test-payment` → open `checkout_url` in new tab) + read-only recent-payments table (status badge, tx_ref, amount, email, size, date).
- `.env.example`: `CHAPA_SECRET_KEY`, `CHAPA_WEBHOOK_SECRET`, `PAYMENTS_POC_ENABLED` documented (all server-only, no `NEXT_PUBLIC_`).

**Build gate:** `npm ci` + `npm run lint` + `next build` all green (verified in throwaway worktree, commit `20eebd6`). Worktree cleaned up.

**USER must do before feature goes live:**
1. Create a Chapa account → get test secret key (`CHASECK_TEST-…`) and webhook secret.
2. Set in Vercel: `CHAPA_SECRET_KEY`, `CHAPA_WEBHOOK_SECRET`, `PAYMENTS_POC_ENABLED=true`.
3. Run `supabase/migrations/0006_payments.sql` in Supabase SQL Editor.
4. Register webhook URL in Chapa dashboard: `https://sole-supply2.vercel.app/api/webhooks/chapa`.
5. Merge PR #20.

**Negative checks (test after deploy):**
- `POST /api/webhooks/chapa` with bad/missing `Chapa-Signature` → 403.
- `POST /api/admin/test-payment` as non-admin → 403.
- `POST /api/admin/test-payment` with `PAYMENTS_POC_ENABLED` unset → 404.
- `select * from payments` via Supabase anon key → RLS blocks, 0 rows.
- Public storefront `/` and `ShoeCard` show no payment UI.

---

### PR #21 — `feat/purchaser-role` — Purchaser role + max-2 cap + bot re-gate (Phase 1)
**URL:** https://github.com/NahomX/Sole-supply2/pull/21
**Branch:** `feat/purchaser-role` (branched from `origin/main` at `94c49c0`)
**Independent** — not stacked on any other open PR; can merge any time.

**What's in it:**
- `supabase/migrations/0007_purchaser_role.sql` (new): (1) idempotently drops and re-adds the `telegram_users.role` CHECK constraint to include `'purchaser'` (now `('admin','shipper','purchaser')`); (2) CREATE OR REPLACE function `check_purchaser_cap()` + BEFORE INSERT OR UPDATE trigger `enforce_purchaser_cap` that raises an exception if a 3rd purchaser row would be created. Idempotent — safe to re-run.
- `lib/bots/registry.ts`: `BotRole` union gains `"purchaser"`; purchaser bot entry role changed from `"shipper"` to `"purchaser"`. `incart`/`arrived`/`delivery` remain `"shipper"`.
- `lib/bots/auth.ts`: `TelegramUser.role` type gains `'purchaser'`; role hierarchy updated — `admin` satisfies any requirement, `purchaser` satisfies only `"purchaser"`, `shipper` satisfies only `"shipper"`.
- `lib/bots/handlers.ts`: `guardAllowlist` signature extended to accept `"purchaser" | "shipper" | "admin"`; `registerWorkBot` derives required role from `entry.role` (cast as `workRole`) so each work bot enforces its own registry role — purchaser bot now requires `"purchaser"`, arrived/delivery keep `"shipper"`. All per-callback re-checks preserved. Interim "advance all sizes" behavior unchanged.
- `.env.example`: no new vars — `PURCHASER_BOT_TOKEN` already documented.

**Build gate:** `npm ci` + `npm run lint` + `next build` all green (verified in throwaway worktree, commit `6a53d33`). Worktree cleaned up.

**USER must do before feature goes live:**
1. Run `supabase/migrations/0007_purchaser_role.sql` in Supabase SQL Editor.
2. Merge PR #21.
3. Add a purchaser: `INSERT INTO telegram_users (telegram_id, role, label) VALUES (<TELEGRAM_ID>, 'purchaser', 'Name');` (max 2; trigger rejects a 3rd).
4. Verify: attempt a 3rd purchaser insert → DB raises exception "Maximum of 2 purchasers allowed."
5. Verify: purchaser-role Telegram user can use the purchaser bot; shipper-role user cannot.

---

### PR #22 — `feat/issuing-rails` — Stripe Issuing governance rails (Phase 2, TEST mode)
**URL:** https://github.com/NahomX/Sole-supply2/pull/22
**Branch:** `feat/issuing-rails` (branched from `feat/purchaser-role`)
**Stacked on PR #21** — merge PR #21 first, then this one.

**What's in it:**
- `package.json` + `package-lock.json`: add `stripe ^22.2.0`.
- `supabase/migrations/0008_issuing_governance.sql` (new): `issuing_cards` (stripe_card_id/cardholder_id/last4/livemode; PAN never stored), `purchase_orders` (max_amount_cents CHECK <= 30000, partial unique index on card_id WHERE status='open', status CHECK draft|open|authorizing|closed|cancelled|failed, single_use + single_use_consumed + expires_at + approved_by bigint + stripe_authorization_id unique + livemode), `issuing_authorizations` (L2 decision log), `spend_ledger` (reserved/settled/voided; idempotent on stripe_authorization_id), `agent_runs` (Phase 3 audit log), `agent_config` (singleton, agent_enabled default false). All tables: RLS enabled, NO policies (service-role only), livemode column, updated_at triggers. Idempotent.
- `lib/issuing.ts` (new, server-only): `provisionCard()` (Stripe cardholder + virtual card, L1 spending_controls: $300/auth $2k/day $5k/month + shoe_stores MCC; stores only stripe_card_id/cardholder_id/last4 — PAN/CVC never stored; livemode detected from key prefix), `freezeCard()`, `getRemainingHeadroom(cardId)` (from spend_ledger, daily + monthly).
- `app/api/webhooks/stripe/route.ts` (new): `POST` handles `issuing_authorization.request` (L2: sig-verify fail-closed → DECLINE; single indexed query with optimistic status='open' guard — approve only if open unexpired single-use PO + amount <= max_amount_cents AND <= 30000 + daily/monthly headroom + MCC in allowed set; on approve: atomically set PO status='authorizing', write spend_ledger reservation, set stripe_authorization_id); `issuing_authorization.updated` / `issuing_transaction.created` (re-verify via Stripe API → close PO status='closed' → settle ledger → advance size_ids from in_cart→purchased via setSizeStatus → ops feed). Idempotent on stripe_authorization_id. livemode guard on all events.
- `lib/bots/handlers.ts`: purchaser bot `/pending` command — lists draft POs (retailer + max $ + size count) with inline Approve/Decline buttons; Approve flips draft→open + sets expires_at ~30 min + records approved_by=telegram_id; Decline → cancelled. guardAllowlist re-verified on every callback.
- `.env.example`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FORWARDING_ADDRESS_*` block (all server-only, no NEXT_PUBLIC_).

**Build gate:** `npm ci` + `npm run lint` + `next build` all green (verified in throwaway worktree `wt-issuing`, commit `b2fc171`). Worktree cleaned up.

**Stripe Dashboard setup (user must do before testing):**
1. Enable Issuing in test mode: Dashboard → Balance → Issuing → Get started.
2. Add webhook endpoint: Dashboard → Developers → Webhooks → Add endpoint.
   - URL: `https://sole-supply2.vercel.app/api/webhooks/stripe`
   - Events: `issuing_authorization.request`, `issuing_authorization.updated`, `issuing_transaction.created`
   - **Set "Default action on timeout" → DECLINE** (critical: webhook outage = no spend).
3. Copy webhook signing secret → set as `STRIPE_WEBHOOK_SECRET` in Vercel.

**USER must do before feature goes live:**
1. Merge PR #21 first.
2. Run `supabase/migrations/0008_issuing_governance.sql` in Supabase SQL Editor.
3. Set Vercel env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FORWARDING_ADDRESS_LINE1/CITY/STATE/POSTAL_CODE/COUNTRY`.
4. Merge PR #22.
5. Complete Stripe Dashboard setup (steps above).
6. Test with Stripe's Issuing test-card simulator (see PR body for step-by-step).

**Decline tests to run before any approval:**
- Bad signature → DECLINE.
- Over $300/auth → DECLINE.
- Wrong MCC (not shoe_stores) → DECLINE.
- No open PO → DECLINE.
- Expired PO → DECLINE.
- Already-used PO (single_use_consumed) → DECLINE.

---

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

**Note:** PR B will repoint the stale-digest to use `OPS_BOT_TOKEN` instead of the standalone `TELEGRAM_BOT_TOKEN`, so these two vars can be unified after PR B merges.

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

## Vercel env vars to set

### For PR A (Telegram bots infra + customer bot):

| Variable | What it is | How to get it |
|---|---|---|
| `TELEGRAM_WEBHOOK_SECRET` | Shared secret for all bot webhooks | `openssl rand -hex 32` |
| `CUSTOMER_BOT_TOKEN` | Customer browse bot token | @BotFather → /newbot |
| `INCART_BOT_TOKEN` | In-cart add bot token | @BotFather → /newbot |
| `PURCHASER_BOT_TOKEN` | Purchaser work bot token | @BotFather → /newbot |
| `ARRIVED_BOT_TOKEN` | Arrived work bot token | @BotFather → /newbot |
| `DELIVERY_BOT_TOKEN` | Delivery work bot token | @BotFather → /newbot |
| `OPS_BOT_TOKEN` | Owner ops bot token | @BotFather → /newbot |

### For PR C (#12) — Shared ops feed:

| Variable | What it is | How to get it |
|---|---|---|
| `OPS_FEED_CHAT_ID` | Negative integer chat ID of the shared ops Telegram group | Create a private group → add ops bot → send any message → read from `getUpdates` (see steps below) |

**Step-by-step to get `OPS_FEED_CHAT_ID` (USER action — cannot be done by PM):**
1. In Telegram, create a **private group** (e.g. "Sole Supply Ops"). Add yourself and any admin teammates.
2. Add the ops bot (the bot you created via @BotFather for `OPS_BOT_TOKEN`) to the group.
3. Send any message in the group (e.g. "test").
4. Open in a browser: `https://api.telegram.org/bot<OPS_BOT_TOKEN>/getUpdates`
5. Look for `"chat":{"id":-XXXXXXXXXX,"type":"group"}` — the **negative number** is the group chat ID.
6. Set `OPS_FEED_CHAT_ID=-XXXXXXXXXX` in Vercel Dashboard → Project → Settings → Environment Variables.

Note: group chat IDs are negative integers. Supergroup IDs begin with `-100`. If `getUpdates` is empty, send another message to the group first.

### For PR #20 (Chapa payments POC):

| Variable | What it is | How to get it |
|---|---|---|
| `CHAPA_SECRET_KEY` | Chapa test secret key | Chapa dashboard → Settings → API Keys (use CHASECK_TEST-… for test mode) |
| `CHAPA_WEBHOOK_SECRET` | HMAC-SHA256 webhook signing secret | Chapa dashboard → Settings → Webhooks → Secret (or generate: `openssl rand -hex 32`) |
| `PAYMENTS_POC_ENABLED` | Feature flag — must be `"true"` to enable the POC | Set to `true` in Vercel env vars |

**Webhook URL to register in Chapa dashboard:** `https://sole-supply2.vercel.app/api/webhooks/chapa`

All three vars are server-only — no `NEXT_PUBLIC_` prefix. Feature is disabled unless `PAYMENTS_POC_ENABLED=true`.

### For PR #9 (stale-digest cron):

| Variable | What it is | How to get it |
|---|---|---|
| `CRON_SECRET` | Shared secret protecting `/api/cron/stale-digest` | Generate: `openssl rand -hex 32` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for the digest | @BotFather (or reuse OPS_BOT_TOKEN after PR B) |
| `TELEGRAM_CHAT_ID` | Destination chat/channel ID | `https://api.telegram.org/bot<TOKEN>/getUpdates` after sending a message |

Set all in Vercel Dashboard → Project → Settings → Environment Variables.

---

## Decisions — RESOLVED (user, 2026-05-31)

1. ✅ **"remove dispatched"** = remove the status from the workflow entirely. → M2 flow is `in_cart → purchased → arrived → delivered`. LIVE.
2. ✅ **Existing `dispatched` rows** → remap to **`purchased`** (conservative). Encoded in 0003 migration before constraint reseat. Verified clean (confirmed 2026-06-02).
3. ✅ **Stale threshold** = **7 days**.
4. ✅ **Stale surfacing** = **dashboard + periodic digest** (Vercel Cron, Telegram).
5. ✅ **Digest channel** = **Telegram** (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`).
6. ✅ **Telegram bots plan** = approved (quizzical-frolicking-sparkle.md). Logistics 4-state: `in_cart → purchased → arrived → delivered`. One shared codebase + registry. grammY + Vercel webhooks. 6 bots. Two PRs.

---

## Build/verify reminders (this env)

Linux node is broken (glibc 2.27). Use Windows `node.exe` / npm-cli.js / `git.exe` / `gh.exe` (authed as NahomX). Migrations are run by the USER in Supabase SQL Editor — the PM hands over the SQL, never claims it's applied.

Note: `package-lock.json` + `.eslintrc.json` were generated and committed as part of the M2/M3 build pass (they were missing from the repo; both landed on main via PR #8).

---

## Changelog

- v17 — 2026-06-04 — pm-sole-supply — PR #22 (feat/issuing-rails, commit b2fc171, stacked on feat/purchaser-role). 7 files (+1312/-7). Phase 2 Stripe Issuing governance rails TEST mode: package.json+lock (+stripe ^22.2.0); 0008_issuing_governance.sql (6 tables: issuing_cards, purchase_orders — max_amount_cents CHECK<=30000 + partial unique index on card_id WHERE status='open' + PO lifecycle status CHECK + single_use+expires_at+approved_by+stripe_authorization_id; issuing_authorizations, spend_ledger, agent_runs, agent_config — singleton agent_enabled=false; all RLS on, no policies, livemode column, updated_at triggers, idempotent); lib/issuing.ts (provisionCard+freezeCard+getRemainingHeadroom, server-only, PAN never stored); app/api/webhooks/stripe/route.ts (L2 issuing_authorization.request: sig-verify fail-closed→DECLINE, single indexed query optimistic-locked, approve only if open unexpired single-use under-cap PO + headroom + MCC allowed; capture event: re-verify→close PO→settle ledger→setSizeStatus in_cart→purchased→ops feed; idempotent on stripe_authorization_id; livemode guard everywhere); lib/bots/handlers.ts (purchaser bot /pending: list draft POs + Approve/Decline inline buttons; Approve→draft→open+expires_at 30min+approved_by; Decline→cancelled; guardAllowlist re-verified on every callback); .env.example (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, FORWARDING_ADDRESS_* — all server-only). No browser, no LLM, no live mode. Build gate green (npm ci + lint + next build in throwaway worktree). PR #22 open, stacked on #21. USER must: run 0008 migration + set Stripe env vars + Stripe dashboard setup (webhook URL + default-decline). Compare-and-swap v16→v17 (N_start=N_disk=16).
- v16 — 2026-06-04 — pm-sole-supply — PR #21 (feat/purchaser-role, commit 6a53d33, branched from origin/main 94c49c0). 4 files (+94/-13). Phase 1 purchaser role: 0007_purchaser_role.sql (extend telegram_users.role CHECK to include 'purchaser'; enforce_purchaser_cap trigger — MAX 2 purchasers, idempotent); lib/bots/registry.ts (BotRole += "purchaser"; purchaser bot entry role "shipper"→"purchaser"); lib/bots/auth.ts (TelegramUser.role += 'purchaser'; role hierarchy: admin satisfies any, purchaser satisfies only purchaser, shipper satisfies only shipper); lib/bots/handlers.ts (guardAllowlist signature += "purchaser"; registerWorkBot derives workRole from entry.role — purchaser bot enforces "purchaser", arrived/delivery keep "shipper"; all per-callback re-checks preserved). No money, no Stripe, no agent. Build gate green (npm ci + lint + next build in throwaway worktree). PR #21 open. USER must run 0007 migration + insert purchaser rows. Compare-and-swap v15→v16 (N_start=N_disk=15).
- v15 — 2026-06-03 — pm-sole-supply — PR #20 (feat/payments-poc, commit 20eebd6, branched from origin/main 94c49c0). 8 files (+728/-2 lines). Chapa admin-only test-mode payment POC: 0006_payments.sql (payments table, RLS on, service-role only, updated_at trigger, idempotent); lib/payments.ts (initChapa, verifyChapa, verifyChapaWebhookSig — HMAC-SHA256 fail-closed); app/api/admin/test-payment/route.ts (POST, double-gated: PAYMENTS_POC_ENABLED + admin role); app/api/webhooks/chapa/route.ts (POST, sig verify fail-closed → re-verify via Chapa before marking paid); lib/supabase.ts (+PaymentStatus+Payment types); app/admin/page.tsx (+recentPayments load); app/admin/AdminDashboard.tsx (+Payments tab, form, recent-payments table); .env.example (+3 server-only Chapa vars). Build gate green (npm ci + lint + next build in throwaway worktree). PR #20 open, independent. USER must: run 0006 migration + set 3 Chapa env vars + register webhook URL in Chapa dashboard. Compare-and-swap v14→v15 (N_start=N_disk=14).
- v14 — 2026-06-04 — pm-sole-supply — PR #18 (feat/per-size-status-p2, commit fd928b8, stacked on feat/per-size-status-p1). 1 file: lib/bots/handlers.ts (+393/-84). Phase 2 per-size bot UX: work bots get drill-down multi-select (pick:{shoeId} → sz:{shoeId}:{usSize} toggle keyboard → go:{shoeId} advance selected or szall:{shoeId} advance all); stateless keyboard design encodes selection as ✓ prefix in button text, no session store, serverless-safe. In-cart bot prompts size selection after shoe creation (ic_sz/ic_done/ic_skip). Ops bot /logistics is full drill-down (ops_log_pick → ops_log_sz → ops_log_st incl. null/clear). guardAllowlist checked on all commands + callbacks. Customer bot unchanged. @grammyjs/types used for InlineKeyboardButton. Build gate green (npm ci + lint + next build in throwaway worktree). PR #18 open. Stacks on PR #16 — merge order: #16 then #18. Compare-and-swap v13→v14 (N_start=N_disk=13).
- v13 — 2026-06-03 — pm-sole-supply — PR #16 (feat/per-size-status-p1, commit 08356aa, branched from main 2f8d8f3). 13 files. New shoe_sizes table (0005 migration — USER must run). Per-size logistics pipeline: lib/supabase.ts (ShoeSize type, logistics_status dropped from Shoe), lib/shoes.ts (per-size helpers: getShoeSizes, setSizeStatus, addSize, removeSize, advanceAllSizes, syncSizesFromText; list helpers join shoe_sizes; setLogisticsStatus removed), lib/labels.ts (sizeLabel, shoeSection, customerLabel refactored), lib/sizes.ts (sizeGridFromSizes + SizeCustomerState), lib/staleness.ts (per-size stale rule), components/ShoeCard.tsx (SizeStrip from DB rows: green/gold/muted/greyed+struck), app/page.tsx (join + shoeSection), app/admin/page.tsx (join), app/admin/AdminDashboard.tsx (per-size chip editor), app/api/shoes/[id]/route.ts (logistics branch dropped), app/api/shoes/[id]/sizes/route.ts (new GET/POST/DELETE/PATCH). Bots interim: advanceAllSizes. Build gate green. PR #16 open. Feature live only after user runs 0005.
- v12 — 2026-06-02 — pm-sole-supply — PR #15 legibility fix (commit 7738e7e). SizeStrip chip styling bumped: US text-[9px]→text-[11px], EU text-[8px]→text-[9px], available EU text-neutral-400→text-neutral-500, sold-out US container text-neutral-300→text-neutral-400, sold-out EU text-neutral-200→text-neutral-300, chip padding px-1→px-1.5. All other SizeStrip behavior (flex-wrap gap-0.5, bilingual label, role/aria, TBA states) preserved. Build gate green (npm ci + lint + next build in throwaway worktree). Pushed to feat/size-availability; PR #15 updated in place. Compare-and-swap v11→v12 (N_start=N_disk=11).
- v11 — 2026-06-02 — pm-sole-supply — PR #15 (feat/size-availability, branched from main 408823a, commit 3aa4959). New lib/sizes.ts: US 7–13 ↔ EU table + parseAvailableSizes (comma/space/slash/range/EU-token) + sizeGrid. ShoeCard: SizeStrip — compact flex-wrap chips, available=solid, unavailable=greyed+strikethrough+aria; bilingual "Sizes · መጠን" label; null/blank sizes → omit strip; garbled → "Sizes TBA / መጠን በቅርቡ". No schema change, no new env vars. Build gate green. PR #15 open, independent (merges any time). Compare-and-swap v10→v11 (N_start=N_disk=10).
- v10 — 2026-06-02 — pm-sole-supply — PR #13 UX/UI review fixes committed (fb731ec, feat/berebaso-rebrand). P0: Noto Sans Ethiopic loaded via next/font/google (--font-ethiopic var); ShoeCard onError img fallback; remotePatterns left permissive. P1: hero dark scrim + text-white/90; duplicate id="in-stock" removed, scroll-mt-24 on actual section, hero CTA anchors to first non-empty section. P2: badge palette (gold for "On the way", espresso for "Coming soon"); JS hover → Tailwind brand tokens + focus-visible; py-2.5/items-stretch tap targets; bilingual footer. Owner-confirmed: brand spelling "በረባሶ" locked; CTA changed to ይያዙ (Reserve). Remaining Amharic copy (hero tagline + 4 subtitles) still needs owner verification. Build gate green. PR #13 description updated. Compare-and-swap v9→v10 (N_start=N_disk=9).
- v9 — 2026-06-02 — pm-sole-supply — PR #13 (feat/berebaso-rebrand, stacked on feat/ops-feed, commit 52685d1). 4 areas: (1) Sole Supply → Berebaso in all display strings (10 files); (2) bilingual EN/Amharic storefront (header lockup, hero, section subtitles, CTA button, Geez font stack); (3) CSS-gradient hero band + brand palette + card hover polish + empty-state card; (4) guardAllowlist shows Telegram ID in denial reply, /whoami added to work bots, README logistics-flow section. Build gate green. Owner must verify all Amharic strings with native speaker before launch. No new env vars. Compare-and-swap v8→v9 (N_start=N_disk=8).
- v8 — 2026-06-02 — pm-sole-supply — PR #12 reliability fix committed (27e99ec, feat/ops-feed): sendTelegramMessage gets optional timeoutMs param (AbortController, default=no timeout); postOpsFeed passes 3000; all three void postOpsFeed call sites changed to await. Build gate green. PR #12 updated in place.
- v7 — 2026-06-02 — pm-sole-supply — PR C (#12) ops feed opened (feat/ops-feed, stacked on feat/telegram-bots-work). Files: lib/shoes.ts (FeedMeta, postOpsFeed, meta param on all 3 transition fns), app/api/shoes/[id]/route.ts (migrated to shared helpers + web actor), app/api/shoes/route.ts (+meta), lib/bots/handlers.ts (botMeta helper + 4 call sites), .env.example (OPS_FEED_CHAT_ID docs). Build gate green (commit b8795d6). 4 PRs now open. Compare-and-swap v6→v7 (N_start=N_disk=6).
- v6 — 2026-06-02 — pm-sole-supply — PR B pushed (#11, feat/telegram-bots-work). Files: scripts/set-webhooks.mjs, lib/staleness.ts, app/api/cron/stale-digest/route.ts (ops-bot repoint), vercel.json. Build gate green. PR A #10 URL updated. STATUS describes 3 open PRs and merge order. Compare-and-swap v5→v6 (N_start=N_disk=5).
- v5 — 2026-06-02 — pm-sole-supply — Telegram bots PR A pushed. New branch feat/telegram-bots (from origin/main bd47541). Files: lib/shoes.ts (extracted logic), lib/telegram.ts, lib/bots/registry.ts, lib/bots/auth.ts, lib/bots/handlers.ts, app/api/telegram/[bot]/route.ts, supabase/migrations/0004_telegram_users.sql. Updated: app/api/shoes/route.ts, app/api/shoes/[id]/route.ts, package.json (+grammy), package-lock.json, .env.example. Build gate green. PR A opened at #10. 0004 migration SQL must be run by user. 6 BotFather tokens + webhook registration are user actions. Compare-and-swap v4→v5 (N_start=N_disk=4).
- v4 — 2026-06-02 — pm-sole-supply — Doc-reconcile only. PR #8 (feat/logistics-in-cart-and-ui) marked MERGED (bd47541, 2026-06-01 17:35 UTC). Migration 0003_logistics_in_cart.sql confirmed run in Supabase by user (2026-06-02), no orphaned dispatched rows — M2 fully live. PR #9 (feat/stale-checker) remains open; blocker updated to: Telegram vars (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID) not yet set in Vercel, plus CRON_SECRET and Vercel plan Cron confirmation. No code changes. Compare-and-swap v3→v4 (N_start=N_disk=3).
- v3 — 2026-05-31 — pm-sole-supply — Built and shipped M1+M2+M3 to two PRs. PR #8 (feat/logistics-in-cart-and-ui): M2 enum change (in_cart/dispatched) + M3 customer labels. PR #9 (feat/stale-checker): M1 dashboard banner + Telegram cron digest. Both lint+build green. Migration SQL handed to user. Vercel env vars documented. Compare-and-swap v2→v3 (N_start=N_disk=2).
- v2 — 2026-05-31 — pm-sole-supply — Locked the 4 scoping decisions from the user: (1) remove `dispatched` entirely; (2) remap existing `dispatched` rows → `purchased` (encoded in 0003 before constraint reseat); (3) stale threshold = 7 days; (4) stale surfacing = dashboard **+ periodic digest**. M1 expanded with part B (Vercel-Cron `/api/cron/stale-digest` route + `vercel.json` + `CRON_SECRET`); one small open item remains = digest channel (Telegram proposed vs. email). M2/M3 unchanged in shape, now LOCKED. Compare-and-swap v1→v2 (N_start=N_disk=1).
- v1 — 2026-05-31 — pm-sole-supply (created by agent-jackson) — Project onboarded into the sandbox: repo `NahomX/Sole-supply2` cloned to `sole-supply/`, codebase studied (Next.js 14 + Supabase, two-status-track model documented). Next phase scoped into M1 (stale-listing checker), M2 (logistics enum: add `in_cart`, remove `dispatched`), M3 (customer-facing UI revision + label-mapping spec). Three load-bearing decisions flagged for user confirmation before M2/M1 lock. Nothing built yet — scope only.
