# Unified Admin Bot -- Design Note

**Date:** 2026-07-20
**Status:** Decided, implementing
**PR:** (to be filled)

## Problem

The current Telegram ops workflow uses six separate bots (customer, incart,
purchaser, arrived, delivery, ops), each as a private DM. This forces
contributors to context-switch between bots, makes it hard to follow the full
pipeline in one view, and complicates onboarding (six BotFather tokens, six
webhook registrations, six env vars).

## Goal

Unify incart/purchaser/arrived/delivery/ops into a SINGLE bot running in ONE
Telegram group chat, with per-action role enforcement. The customer bot stays
separate (public audience, different use case).

## Design Decisions

### 1. Single flat group chat (not forum topics)

**Decision: flat group chat.**

Trade-offs considered:
- **Forum topics** (one topic per pipeline stage) give visual separation, but
  add routing complexity (topic_id detection, creating/managing topics, messages
  can land in the wrong topic). Topics also require a supergroup upgrade.
- **Flat group** is simpler: everyone sees everything (which is the point --
  shared visibility), and per-action role checks ensure only authorized users
  can perform privileged actions. The group is already small (2-5 contributors).

### 2. Group authorization: two layers

1. **Chat-level:** `ADMIN_GROUP_CHAT_ID` env var. The bot refuses to process any
   update that does not come from this chat ID (or from a private DM with the
   bot, for /whoami). Fail-closed: if the env var is missing, the bot rejects
   all group messages.
2. **User-level:** Every privileged action calls a per-action role check against
   `telegram_users`. The role required depends on the specific action, not on
   which "bot" the user is talking to.

### 3. Migration: additive, not destructive

**Decision: add the unified bot alongside existing bots; do NOT remove old ones.**

- A new `unified` entry in `BOT_REGISTRY` with its own `UNIFIED_BOT_TOKEN` env
  var and a `registerUnifiedBot` handler.
- The five existing DM bots (incart/purchaser/arrived/delivery/ops) stay
  functional. The user can retire them at their own pace (stop the webhooks,
  remove tokens).
- The `customer` bot is completely unaffected -- it serves a different audience.

### 4. Per-action role mapping

| Action | Required role | Notes |
|--------|--------------|-------|
| `/add <URL>` (create shoe + pick sizes) | shipper | Same as incart bot |
| `/purchase` (advance in_cart -> purchased) | purchaser | Same as purchaser bot |
| `/arrive` (advance purchased -> arrived) | shipper | Same as arrived bot |
| `/deliver` (advance arrived -> delivered) | shipper | Same as delivery bot |
| `/pending` (PO approve/decline) | purchaser | Same as purchaser bot |
| `/sales` (sales status) | admin | Same as ops bot |
| `/logistics` (arbitrary corrections) | admin | Same as ops bot |
| `/edit`, `/remove`, `/copy` | admin | Same as ops bot |
| `/setprice`, `/clearvideo` | admin | Same as ops bot |
| Video upload | admin | Same as ops bot |
| Photo match (purchase flow) | purchaser | Based on target transition |
| Photo match (arrive/deliver) | shipper | Based on target transition |
| NL free text | admin | Same as ops bot |
| `/list` (full pipeline overview) | admin | Same as ops bot |
| `/start`, `/help`, `/whoami` | (any group member) | No role check |

### 5. Preserved sub-flows

Every existing sub-flow has a home in the unified bot:

| Sub-flow | Old bot | Unified command | UX change |
|----------|---------|-----------------|-----------|
| Add shoe (paste URL, scrape, size picker) | incart | `/add <URL>` | Now includes quantity picker (fix) |
| Advance to purchased | purchaser | `/purchase` | Same drill-down UX |
| Advance to arrived | arrived | `/arrive` | Same drill-down UX |
| Advance to delivered | delivery | `/deliver` | Same drill-down UX |
| PO approve/decline | purchaser | `/pending` | Identical |
| Receipt photo match | arrived/delivery | Send photo -> pick flow | Adds flow-selection step |
| Arbitrary sales correction | ops | `/sales` | Identical |
| Arbitrary logistics correction | ops | `/logistics` | Identical |
| Shoe field editing | ops | `/edit` | Identical |
| Birr price setter | ops | `/setprice` | Identical |
| Video upload | ops | Send video -> pick shoe | Identical |
| Clear video | ops | `/clearvideo` | Identical |
| Website copy editing | ops | `/copy` | Identical |
| NL intent editing | ops | Plain text | Identical |
| Soft remove | ops | `/remove` | Identical |

### 6. Quantity fix (consistency)

The incart bot's add-shoe flow calls `addSize(shoeId, sz)` without passing
quantity, ignoring the quantity feature shipped in PR #37. The unified bot's
`/add` flow includes a quantity picker row in the size-selection keyboard:

```
[US 7] [US 7.5] [US 8] [US 8.5]
...
Qty per size: [* 1] [2] [3] [5] [10]
[Add selected sizes] [Skip (add later)]
```

The `*` prefix marks the active quantity (default 1). On "Add selected sizes",
the handler reads the selected quantity from the keyboard and passes it to every
`addSize()` call.

### 7. Callback data scheme

All callbacks are namespaced with `u_` to avoid collision with old bots. All
values stay within Telegram's 64-byte callback_data limit.

See `lib/bots/unified-handler.ts` header comment for the full scheme.

### 8. No schema changes

No new migrations. The `telegram_users` table already has `role` and
`allowed_bots` columns. The `shoe_sizes.quantity` column already exists
(migration 0013). The only new env vars are:
- `UNIFIED_BOT_TOKEN` -- BotFather token for the unified bot
- `ADMIN_GROUP_CHAT_ID` -- already exists (used for ops feed); reused here

### 9. File structure

- `lib/bots/unified-handler.ts` -- new file, contains `registerUnifiedBot`
- `lib/bots/registry.ts` -- add `unified` entry
- `app/api/telegram/[bot]/route.ts` -- add `registerUnifiedBot` case
- `lib/bots/auth.ts` -- extend role hierarchy (shipper satisfies purchaser
  transitions are NOT valid; each role is independent, admin satisfies all)
- `docs/unified-admin-bot.md` -- this document
