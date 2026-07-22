# Berebaso / Sole Supply -- Admin Manual

Last updated: 2026-07-21

This manual documents every admin and ops surface of the Berebaso sneaker-import app. It is written for the business owner and anyone granted the admin role.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Roles and Permissions](#2-roles-and-permissions)
3. [Telegram Unified Admin Bot -- Full Command Reference](#3-telegram-unified-admin-bot----full-command-reference)
4. [Web Admin Dashboard](#4-web-admin-dashboard)
5. [Setup and Operational Reference](#5-setup-and-operational-reference)
6. [Legacy Bots](#6-legacy-bots)

---

## 1. Overview

There are two admin surfaces:

- **Web admin dashboard** (`/admin`) -- a browser-based UI for managing shoes, users, and customer interests. Use it for bulk inventory review, Excel exports, onboarding web users, and detailed per-shoe editing with the audit timeline.

- **Telegram unified admin group bot** -- a single Telegram bot running in one private group chat that consolidates the entire procurement-to-delivery pipeline. Use it for day-to-day ops: adding shoes, advancing logistics stages, approving purchase orders, attaching videos, editing fields, and AI photo-matching -- all from your phone.

Both surfaces operate on the same database. Changes made in one are immediately visible in the other.

---

## 2. Roles and Permissions

### 2.1 The three ops roles

| Role | Scope | Who |
|------|-------|-----|
| **admin** | Full access to everything -- all pipeline actions, shoe editing, user management, website copy, sales status, logistics corrections, export, video, NL editing. | The business owner and trusted operators. |
| **shipper** | Add shoes to the pipeline (`/add`), advance purchased sizes to arrived (`/arrive`), advance arrived sizes to delivered (`/deliver`). On the web dashboard: view the Shoes tab and change per-size logistics status. | Distributors / shipping partners. |
| **purchaser** | Advance in-cart sizes to purchased (`/purchase`), approve or decline draft Purchase Orders (`/pending`). | The person who buys shoes from US retailers. |

### 2.2 Role hierarchy

Roles are **siloed** -- a purchaser cannot perform shipper actions, and a shipper cannot perform purchaser actions. The one exception is **admin**, which satisfies any role requirement. In code (`lib/bots/auth.ts`):

```
admin     -> satisfies admin, shipper, AND purchaser
shipper   -> satisfies shipper only
purchaser -> satisfies purchaser only
```

### 2.3 Telegram allowlist (`telegram_users` table)

Every privileged Telegram action checks the `telegram_users` database table. A user must have a row in this table with:

- `telegram_id` -- their numeric Telegram ID
- `role` -- one of `admin`, `shipper`, or `purchaser`
- `allowed_bots` (optional) -- if set, an array of bot names the user can use (e.g. `["unified"]`). If null, the user can use any bot their role permits.

**How to onboard a Telegram team member:**

1. Have them message the bot with `/whoami` (works in the group or in a private DM). The bot replies with their numeric Telegram ID.
2. In the Supabase Table Editor, insert a row into `telegram_users`: set `telegram_id`, `role`, and optionally `label` (a human-readable name for your reference).
3. Add them to the private Telegram admin group.

### 2.4 Web dashboard roles

The web dashboard uses the `profiles` table (populated by Supabase Auth). Roles are: `customer`, `submitter`, `shipper`, `admin`. Only `admin` and `shipper` can access `/admin`. Admins see all tabs (Shoes, Users, Interests, and optionally Payments). Shippers see only the Shoes tab and can only change per-size logistics status.

### 2.5 Permissions summary table

| Action | Required role | Where |
|--------|--------------|-------|
| Add a shoe (`/add <URL>`) | shipper | Telegram |
| Advance in_cart to purchased | purchaser | Telegram (`/purchase`) |
| Advance purchased to arrived | shipper | Telegram (`/arrive`) or web dashboard |
| Advance arrived to delivered | shipper | Telegram (`/deliver`) or web dashboard |
| Approve/decline Purchase Orders | purchaser | Telegram (`/pending`) |
| Change sales status (upcoming/available/sold) | admin | Telegram (`/sales`) or web dashboard |
| Arbitrary logistics corrections | admin | Telegram (`/logistics`) or web dashboard |
| Edit shoe fields (title, brand, price, notes, sizes) | admin | Telegram (`/edit`) or web dashboard |
| Set birr price | admin | Telegram (`/setprice`) or web dashboard |
| Upload/clear video | admin | Telegram (send video / `/clearvideo`) |
| Remove (hide) a shoe | admin | Telegram (`/remove`) or web dashboard |
| Edit website copy | admin | Telegram (`/copy`) |
| Natural-language editing | admin | Telegram (plain text) |
| View full pipeline list | admin | Telegram (`/list`) |
| AI photo matching (purchase flow) | purchaser | Telegram (send photo) |
| AI photo matching (arrival/delivery) | shipper | Telegram (send photo) |
| Export shoes to Excel | admin | Web dashboard |
| Manage users / send invites | admin | Web dashboard |
| View customer interests | admin | Web dashboard |
| `/start`, `/help` | any group member | Telegram |
| `/whoami` | anyone (group or DM) | Telegram |

---

## 3. Telegram Unified Admin Bot -- Full Command Reference

The unified bot runs in a single private Telegram group chat, identified by the `ADMIN_GROUP_CHAT_ID` environment variable. It will refuse to process messages from any other chat (fail-closed: if the env var is missing, the bot rejects everything).

### 3.1 The logistics pipeline

Each shoe has sizes, and each size moves independently through this pipeline:

```
in_cart --> purchased --> arrived --> delivered
```

- **in_cart**: The shoe/size has been added to the procurement queue.
- **purchased**: A purchaser has bought it from the US retailer.
- **arrived**: The shipment has arrived (at the forwarding address or in Addis).
- **delivered**: Handed to the customer or in-store.

Each hop is driven by a specific command:

| Transition | Command | Required role |
|-----------|---------|--------------|
| (new shoe) to in_cart | `/add <URL>` | shipper |
| in_cart to purchased | `/purchase` | purchaser |
| purchased to arrived | `/arrive` | shipper |
| arrived to delivered | `/deliver` | shipper |

The sales status track (`upcoming` / `available` / `sold`) is separate and managed via `/sales` (admin only).

---

### 3.2 Command reference

#### `/start` and `/help`

**Role required:** None (any group member).

Displays the full list of available commands with brief descriptions. `/start` and `/help` produce similar output.

---

#### `/whoami`

**Role required:** None. Works in both the admin group and in a private DM with the bot.

Replies with your numeric Telegram ID and username. Use this to get someone's ID before adding them to the `telegram_users` allowlist.

---

#### `/add <URL>` -- Add a shoe

**Role required:** shipper

**How it works:** Type `/add` followed by a full retailer product URL (must start with `http://` or `https://`). The URL is passed as a command argument -- the bot reads it from the command text, not from a separate message.

**Step-by-step flow:**

1. Send: `/add https://www.nike.com/t/air-jordan-1-retro-high-og-shoe/...`
2. Bot replies "Scraping..." and fetches the Open Graph title, image, and price from the URL.
3. Bot shows the scraped shoe details and a size-selection keyboard:
   - **Size buttons** arranged in a grid (US 3.5 through US 18). Tap to toggle (selected sizes get a checkmark prefix).
   - **Quantity row**: `[* 1] [2] [3] [5] [10]` -- tap to select how many pairs per size (default: 1, marked with `*`). This is a radio selector; only one quantity can be active.
   - **Action buttons**: "Add selected sizes" and "Skip (add later)".
4. Tap sizes to select them, optionally change the quantity, then tap "Add selected sizes".
5. All selected sizes are created in the `shoe_sizes` table with `logistics_status = in_cart` and the chosen quantity.
6. If you tap "Skip", no sizes are added -- you can add them later via `/admin` on the web or via `/edit`.

---

#### `/purchase` -- Advance in-cart sizes to purchased

**Role required:** purchaser

**Step-by-step flow:**

1. Send `/purchase`.
2. Bot lists all shoes that have at least one size at `in_cart` (up to 20 shoes). Each shoe is a button.
3. Tap a shoe. Bot shows all sizes of that shoe that are currently `in_cart`, each as a toggle button.
4. Tap sizes to select them (checkmark prefix toggles on/off).
5. Choose an action:
   - **"Advance selected"** -- moves only the checked sizes to `purchased`.
   - **"Advance all"** -- moves every eligible size to `purchased` (ignores your selection).
6. Bot confirms how many sizes were advanced.

---

#### `/arrive` -- Advance purchased sizes to arrived

**Role required:** shipper

Same interactive flow as `/purchase`, but operates on sizes currently at `purchased` and advances them to `arrived`.

---

#### `/deliver` -- Advance arrived sizes to delivered

**Role required:** shipper

Same interactive flow as `/purchase`, but operates on sizes currently at `arrived` and advances them to `delivered`.

---

#### `/pending` -- Draft Purchase Order approval

**Role required:** purchaser

**How it works:** Lists all Purchase Orders with `status = draft` (up to 10). For each PO, the bot shows:

- Retailer domain
- Maximum authorized spend (in USD)
- Number of sizes
- Short PO ID

Each PO has two buttons: **"Approve"** and **"Decline"**.

- **Approve**: sets the PO status to `open`, records the approver's Telegram ID and a 30-minute expiration. The autonomous agent can then spend up to the authorized amount at the retailer within that window.
- **Decline**: sets the PO status to `cancelled`.

---

#### `/sales` -- Manage sales status

**Role required:** admin

**Step-by-step flow:**

1. Send `/sales`.
2. Bot lists all shoes (up to 20) with their current sales status in brackets.
3. Tap a shoe.
4. Bot shows the three sales statuses as buttons: `upcoming`, `available`, `sold`.
5. Tap one. The shoe's sales status is updated.

---

#### `/logistics` -- Per-size logistics corrections

**Role required:** admin

Use this for arbitrary status corrections (e.g., fixing a mistake, resetting a size to an earlier state).

**Step-by-step flow:**

1. Send `/logistics`.
2. Bot lists all shoes with a summary of each shoe's sizes and their current status.
3. Tap a shoe. Bot shows all sizes of that shoe with their current logistics status.
4. Tap a size. Bot shows the four logistics statuses (`in_cart`, `purchased`, `arrived`, `delivered`) plus "clear (not started)" to reset to null.
5. Tap a status. The size is updated.

---

#### `/edit` -- Edit shoe fields

**Role required:** admin

**Step-by-step flow:**

1. Send `/edit`.
2. Bot lists all shoes as buttons. Tap one.
3. Bot shows a field menu: **Title**, **Brand**, **Price**, **Notes**, **Sizes**, **Sales status**.
4. Pick a field:
   - **Title / Brand / Price / Notes**: Bot prompts "reply with the value" using Telegram's force-reply. Type the new value as a reply.
   - **Sizes**: Bot prompts "reply with the sizes (e.g. 8, 9, 10.5)". The size list is synced -- sizes not in your list are removed, new ones are added.
   - **Sales status**: Bot shows `upcoming` / `available` / `sold` as buttons. Tap one to apply.

---

#### `/setprice` -- Set birr price

**Role required:** admin

**Step-by-step flow:**

1. Send `/setprice`.
2. Bot lists all shoes. Tap one.
3. Bot shows the current birr price (or "not set") and prompts: "Reply with a whole birr amount (e.g. 18500), or 'none' to clear."
4. Reply with the amount. The price is saved and shown to customers on the storefront.

---

#### `/remove` -- Hide a shoe from the storefront

**Role required:** admin

**Step-by-step flow:**

1. Send `/remove`.
2. Bot lists all shoes. Tap one.
3. Bot asks for confirmation: "Remove [shoe name]? It will be hidden from the storefront (the record is kept)."
4. Tap **"Yes, remove"** to hide it, or **"No, cancel"** to abort.

This is a soft delete -- the database record is preserved.

---

#### `/clearvideo` -- Remove a shoe's video

**Role required:** admin

**Step-by-step flow:**

1. Send `/clearvideo`.
2. Bot lists only shoes that currently have a video attached. If none do, it says so.
3. Tap a shoe. The video URL is cleared. The shoe will no longer show a video on the storefront.

---

#### `/copy` -- Edit website copy

**Role required:** admin

Manages the bilingual (English/Amharic) text strings used on the storefront, stored in the `site_copy` table.

**Step-by-step flow:**

1. Send `/copy`.
2. Bot shows the available copy keys as buttons:
   - `hero_tagline`
   - `section_available`
   - `section_on_the_way`
   - `section_coming_soon`
   - `section_previously`
   - `footer`
3. Tap a key. Bot shows the current English and Amharic values and offers two buttons: **"English"** and **"Amharic"**.
4. Tap a language. Bot prompts "reply with the text."
5. Reply with the new copy. It is saved immediately.

---

#### `/list` -- Full pipeline overview

**Role required:** admin

Displays a text summary of all shoes and their per-size logistics status in one message. Format:

```
Pipeline (N shoes):

* [upcoming] Nike Air Jordan 1 Retro -- 9:in_cart, 10:purchased
* [available] Adidas Yeezy 350 -- 8:arrived, 9:delivered
```

---

#### Video upload -- Attach a video to a shoe

**Role required:** admin

**How it works:** Send a video file (as a Telegram video or as a document with a `video/*` MIME type) directly into the group chat. The bot detects it and starts the flow.

**Step-by-step flow:**

1. Send a video into the group (must be under 19 MB -- Telegram's bot download limit).
2. Bot replies (as a reply to your video): "Pick the shoe to attach this video to:" with a shoe-picker keyboard.
3. Tap a shoe. Bot downloads the video from Telegram, uploads it to Supabase Storage (`shoe-videos` bucket), and sets the shoe's `video_url`.
4. Bot confirms with the shoe title and the public video URL.

If the video exceeds the size limit, the bot replies with an error asking you to compress or trim it.

---

#### Photo match -- AI shoe identification

**Role required:** shipper or purchaser (depends on the selected flow)

Send a photo of a shoe (e.g., a receipt photo, an arrival photo) into the group. The bot uses Gemini AI vision to match it against the catalog.

**Step-by-step flow:**

1. Send a photo into the group.
2. Bot asks "What flow is this photo for?" with three buttons:
   - **"Purchase (in_cart to purchased)"** -- requires purchaser role
   - **"Arrival (purchased to arrived)"** -- requires shipper role
   - **"Delivery (arrived to delivered)"** -- requires shipper role
3. Tap the relevant flow. Bot replies "Analyzing photo..." and runs AI matching against shoes that have sizes at the flow's source status.
4. Bot shows up to 3 matches with confidence labels:
   - "Strong match: [shoe name] -- advance?"
   - "Possible match: [shoe name] -- advance?"
   - "Weak match: [shoe name] -- advance?"
   - "None of these"
5. Tap a match to confirm. The bot advances **all eligible sizes** of that shoe to the target status (e.g., all `purchased` sizes become `arrived`).
6. Tap "None of these" to cancel. The bot suggests using the manual pipeline command instead.

**Requirement:** The `GEMINI_API_KEY` environment variable must be set. Without it, photo matching returns an error message but does not crash.

---

#### Natural-language editing -- Plain text commands

**Role required:** admin

**Prerequisite:** `SITE_EDIT_NL_ENABLED=true` and `ANTHROPIC_API_KEY` must both be set in environment variables.

**How it works:** Type a plain-text instruction in the group (not starting with `/`, and not a reply to a bot prompt). The bot uses Claude AI to interpret your intent and proposes a change.

**Examples of what you can type:**

- "mark the Jordan 1s as sold"
- "set the price of the Yeezy to 15000 birr"
- "change the hero tagline to 'Fresh kicks from the US'"
- "remove the New Balance 550"

**Step-by-step flow:**

1. Type your instruction as a plain message.
2. Bot interprets it and replies with a summary of the proposed change and two buttons: **"Yes, apply"** and **"No, cancel"**.
3. Tap "Yes, apply" to execute the change, or "No, cancel" to abort.

The NL engine can handle these operation types:
- Edit a shoe field (title, brand, price, notes)
- Set sales status
- Set website copy
- Remove a shoe
- Set/clear birr price
- Clear a video

If the bot cannot understand the instruction, it replies suggesting you use `/edit`, `/remove`, or `/copy` instead.

---

### 3.3 BotFather group-privacy consideration

Telegram bots have a "Group Privacy" setting in BotFather. When group privacy is **enabled** (the default), the bot only receives:
- Messages that start with `/` (commands)
- Replies to the bot's own messages

When group privacy is **disabled**, the bot receives all messages in the group.

**For the unified bot, group privacy should be disabled** if you want these features to work:

- **Plain-text natural-language editing** -- the bot needs to read non-command text messages to interpret them as NL instructions.
- **Video uploads** -- the bot needs to detect incoming video messages that are not replies or commands.
- **Photo matching** -- the bot needs to detect incoming photos.

Commands like `/add <URL>`, `/purchase`, `/arrive`, and all other `/`-prefixed commands work regardless of the group privacy setting because they are standard bot commands. The `/add` command takes the URL as a command argument (not from a separate message), so it works with group privacy enabled.

**To disable group privacy:**
1. Open a DM with @BotFather.
2. Send `/mybots` and select your unified bot.
3. Go to Bot Settings > Group Privacy > Turn off.

---

## 4. Web Admin Dashboard

Access: Navigate to `/admin`. You must be signed in with an account whose role is `admin` or `shipper`. If not signed in, you are redirected to the sign-in page.

### 4.1 Dashboard header

- **Title**: "Admin" for admins, "Logistics" for shippers.
- **Export to Excel** button (admin only, top-right): downloads a `.xlsx` spreadsheet of all shoes. See section 4.5.
- **Your email** is shown in the top-right corner.

### 4.2 Tabs

Admins see four tabs (or three if payments POC is disabled):
- **Shoes** -- the main inventory view
- **Users** -- manage web app users
- **Interests** -- customer interest submissions
- **Payments (test)** -- only shown when `PAYMENTS_POC_ENABLED=true`

Shippers see only the **Shoes** tab.

### 4.3 Shoes tab

#### Filter bar

At the top of the Shoes tab is a filter bar with two dropdown selectors:

- **Sales status**: filter to `upcoming`, `available`, or `sold` (or "All").
- **Logistics status**: filter to shoes that have at least one size at `in_cart`, `purchased`, `arrived`, or `delivered` (or "All").

Filters are AND-combined. A "Clear filters" link and a count ("N of M") appear when filters are active.

#### Stale attention banner

If any shoes meet the stale criteria (sales status is `upcoming`, no logistics progress, and more than 7 days old), a yellow/amber banner appears:

> "(warning) N shoes need attention (upcoming, no logistics progress, >7 days old)"

Click the banner to toggle between showing only stale shoes and showing all shoes.

#### Per-shoe card

Each shoe is displayed as a card containing:

- **Thumbnail** -- the scraped product image (or a placeholder).
- **Title** -- for admins, this is a clickable link to the retailer product URL (the procurement source). For shippers, it is plain text (the URL is not exposed).
- **Brand** -- shown in small uppercase text below the title.
- **Notes** -- shown in small text if present.
- **Sales status dropdown** (admin only) -- a select box showing `upcoming`, `available`, or `sold`. Change it to update the shoe's sales status.
- **Interest count** (admin only) -- e.g., "3 interested".
- **Stale badge** -- an amber badge reading "Stale . Nd" (N = days old) if the shoe is stale.
- **Delete button** (admin only) -- permanently deletes the shoe (with confirmation dialog).

#### Per-size logistics cards

Below each shoe's header is the "Sizes & logistics" section. Each size is rendered as a small card (chip) with color-coded styling:

**Status badge color mapping:**

| Logistics status | Badge color | Card border/background |
|-----------------|------------|----------------------|
| **In cart** | Sky blue badge (white text) | Sky blue border, light blue background |
| **Purchased** | Amber/gold badge (white text) | Amber border, light amber background |
| **Arrived** | Emerald green badge (white text) | Green border, light green background |
| **Delivered** | Neutral gray badge (white text) | Gray border, light gray background |
| **Not started** (null) | Light gray badge (dark text) | Default border, white background |

Each size card shows:

1. **Size label**: e.g., "US 9"
2. **Quantity**: shown as "xN" when quantity is greater than 1
3. **Status badge**: the current logistics status with the color mapping above
4. **Quick-action button** (both admin and shipper): a white outlined button with an arrow showing the next logical step (e.g., "-> Arrived" for a size currently at `purchased`). Tap to advance one step. Not shown for `delivered` (terminal state).
5. **Admin override dropdown** (admin only): labeled "Set:", allows setting the logistics status to any value or clearing it to "none". This is for corrections.
6. **Quantity editor** (admin only): a small numeric input labeled "Qty:" to adjust the pair count.
7. **Remove link** (admin only): a small "remove" text link that deletes the size (with confirmation).

**Batch quick-action button**: When multiple sizes share the same actionable status (e.g., three sizes all at `purchased`), a batch button appears in the section heading: e.g., "Arrived all (3)". It triggers a browser confirmation dialog before applying.

**Add size** (admin only): Below the existing size cards, a dropdown of available sizes (from the standard size grid that are not yet added to this shoe) and a "+ Add size" button.

#### Event timeline

If a shoe has recorded events in the `shoe_events` audit log, a collapsible "Timeline (N)" section appears at the bottom of the card. Click to expand.

Each event row shows:
- An icon: a square for creation, a circle for sales status change, an arrow for logistics status change
- Timestamp (month, day, hour:minute)
- Event description (e.g., "Sales: upcoming -> available" or "US 9: in_cart -> purchased")
- Actor and source (e.g., "@nahom via unified")

Events are recorded automatically on every status change. Historical events from before migration 0010 was applied are not present (expected).

### 4.4 Users tab (admin only)

#### Invite form

At the top is an invite form with:
- An email input field
- A role dropdown (`customer`, `submitter`, `shipper`, `admin`)
- A "Send invite" button

The invited person receives a magic-link email and is assigned the chosen role when they accept.

#### Users table

Below the invite form is a table of all registered users:

| Column | Description |
|--------|-------------|
| Email | The user's email address |
| Role | A dropdown to change the user's role (`customer`, `submitter`, `shipper`, `admin`) |
| Joined | The date the user created their account |

Changing a user's role takes effect immediately.

### 4.5 Interests tab (admin only)

Shows shoes that have customer interest submissions, grouped by shoe. Each shoe section displays:
- Shoe thumbnail, brand, and title
- Count of interested users
- A list of each interest submission: email (or user ID), requested size, notes, and date

### 4.6 Export to Excel (admin only)

Click the "Export to Excel" button in the top-right corner. The browser downloads a file named `sole-supply-shoes-YYYY-MM-DD.xlsx`.

**Spreadsheet structure:** One row per (shoe, size) combination. Shoes with no sizes get a single row with blank size columns.

| Column | Description |
|--------|-------------|
| Title | Shoe title |
| Brand | Brand name |
| Sales Status | `upcoming`, `available`, or `sold` |
| Price (USD) | Retailer USD price (if scraped) |
| Price (ETB) | Admin-set birr price |
| US Size | e.g., "9", "10.5" |
| Logistics Status | e.g., "in_cart", "purchased", "arrived", "delivered", or "not started" |
| Quantity | Number of pairs at this size |
| Created | Date the shoe was added |
| Age (days) | Days since creation |
| Stale | "Yes" if the shoe meets the stale criteria, blank otherwise |

The spreadsheet has auto-filter enabled on all columns, so you can immediately sort and filter in Excel.

### 4.7 Session expiry

Authenticated sessions expire automatically based on two timeout windows:

| Window | Default | Configurable via |
|--------|---------|-----------------|
| **Idle timeout** | 30 minutes of no requests | `SESSION_IDLE_TIMEOUT_MINUTES` env var |
| **Absolute lifetime** | 8 hours after login | `SESSION_ABSOLUTE_TIMEOUT_HOURS` env var |

- **Idle**: If you do nothing for 30 minutes (default), your next request will sign you out and redirect to the sign-in page with a "session expired" message.
- **Absolute**: Even if you remain active, you will be signed out 8 hours (default) after you originally logged in.

When your session expires, you must request a new magic link to sign back in. This applies equally to admin and shipper sessions.

The timeouts are enforced server-side via HttpOnly cookies (`ss_login_at` and `ss_last_activity`), checked by the middleware on every request. They cannot be bypassed client-side.

---

## 5. Setup and Operational Reference

### 5.1 Key environment variables

All Telegram-related variables are server-only (never prefixed with `NEXT_PUBLIC_`).

**Telegram bots:**

| Variable | Purpose |
|----------|---------|
| `UNIFIED_BOT_TOKEN` | BotFather token for the unified admin group bot |
| `ADMIN_GROUP_CHAT_ID` | Numeric chat ID of the private Telegram group (negative integer). The unified bot only processes messages from this chat. |
| `TELEGRAM_WEBHOOK_SECRET` | Shared secret for webhook verification. Generate with `openssl rand -hex 32`. |
| `OPS_FEED_CHAT_ID` | Chat ID for the ops activity feed (can be the same group as `ADMIN_GROUP_CHAT_ID`). Every status change posts a one-line message here. |

**Legacy bot tokens** (only needed if the six legacy DM bots are in use):

| Variable | Bot |
|----------|-----|
| `CUSTOMER_BOT_TOKEN` | Public customer browse bot |
| `INCART_BOT_TOKEN` | In-cart (add shoe) DM bot |
| `PURCHASER_BOT_TOKEN` | Purchaser DM bot |
| `ARRIVED_BOT_TOKEN` | Arrived DM bot |
| `DELIVERY_BOT_TOKEN` | Delivery DM bot |
| `OPS_BOT_TOKEN` | Owner ops DM bot |

**AI features:**

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Gemini API key for AI photo-matching (shoe identification). Get from https://aistudio.google.com/app/apikey |
| `ANTHROPIC_API_KEY` | Anthropic API key for natural-language editing (Tier 2). Only needed if NL editing is desired. |
| `SITE_EDIT_NL_ENABLED` | Set to `true` to enable NL plain-text editing. Both this and `ANTHROPIC_API_KEY` must be set. |

**Session timeouts:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `SESSION_IDLE_TIMEOUT_MINUTES` | 30 | Minutes of inactivity before session expires |
| `SESSION_ABSOLUTE_TIMEOUT_HOURS` | 8 | Hours after login before forced re-authentication |

**Storefront contact info** (all `NEXT_PUBLIC_` -- safe for client-side):

| Variable | Example |
|----------|---------|
| `NEXT_PUBLIC_STORE_ADDRESS_EN` | Bole Road, Addis Ababa |
| `NEXT_PUBLIC_STORE_ADDRESS_AM` | (Amharic equivalent) |
| `NEXT_PUBLIC_STORE_PHONE` | +251 911 123 456 |
| `NEXT_PUBLIC_STORE_TELEGRAM` | berebaso |
| `NEXT_PUBLIC_STORE_HOURS` | Mon-Sat, 9:00-19:00 |

**Other:**

| Variable | Purpose |
|----------|---------|
| `CRON_SECRET` | Protects the `/api/cron/stale-digest` endpoint (Vercel Cron injects this automatically) |

### 5.2 Webhook registration

Webhooks connect Telegram to the app. They are registered using the `scripts/set-webhooks.mjs` script.

**Register webhooks:**

```bash
UNIFIED_BOT_TOKEN=<token> TELEGRAM_WEBHOOK_SECRET=<secret> \
  node scripts/set-webhooks.mjs register https://your-app.vercel.app
```

This sets the webhook URL for each bot to `https://your-app.vercel.app/api/telegram/<botname>`, passing the shared webhook secret for verification. It also sets `allowed_updates` to `["message", "callback_query"]` and drops any pending updates.

**Check webhook status:**

```bash
UNIFIED_BOT_TOKEN=<token> node scripts/set-webhooks.mjs info
```

**Clear webhooks:**

```bash
UNIFIED_BOT_TOKEN=<token> node scripts/set-webhooks.mjs clear
```

The script reads tokens from environment variables -- it does not read `.env.local` automatically. Export them or pass them inline.

The webhook route (`app/api/telegram/[bot]/route.ts`) verifies the `X-Telegram-Bot-Api-Secret-Token` header against `TELEGRAM_WEBHOOK_SECRET` on every incoming request. If the secret does not match, it returns 403. If the bot token env var is missing, it returns 500.

### 5.3 Webhook URL format

Each bot's webhook URL follows the pattern:

```
https://<VERCEL_URL>/api/telegram/<bot-name>
```

For the unified bot: `https://<VERCEL_URL>/api/telegram/unified`

---

## 6. Legacy Bots

Six original DM bots predate the unified admin group bot:

| Bot name | Token env var | Role | Purpose |
|----------|---------------|------|---------|
| `customer` | `CUSTOMER_BOT_TOKEN` | public | Browse available/upcoming shoes (public-facing, separate audience) |
| `incart` | `INCART_BOT_TOKEN` | shipper | Add shoes via URL |
| `purchaser` | `PURCHASER_BOT_TOKEN` | purchaser | Mark shoes as purchased |
| `arrived` | `ARRIVED_BOT_TOKEN` | shipper | Mark shoes as arrived |
| `delivery` | `DELIVERY_BOT_TOKEN` | shipper | Mark shoes as delivered |
| `ops` | `OPS_BOT_TOKEN` | admin | Full pipeline control (sales, logistics, editing, copy) |

**The five operational bots (incart, purchaser, arrived, delivery, ops) are fully replaced by the unified bot.** They still function if their tokens are set, but can be retired by removing their webhook registrations and tokens. The **customer bot is separate** and serves a different audience (public customers browsing via Telegram) -- it is not part of the unified bot.

To retire a legacy bot: clear its webhook (`node scripts/set-webhooks.mjs clear` with only that token set), then remove the token from Vercel env vars.
