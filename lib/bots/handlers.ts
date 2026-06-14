/**
 * lib/bots/handlers.ts — grammY handlers for every bot.
 *
 * Each exported function receives a grammY `Bot` instance (already constructed
 * with the correct token) and the bot's registry entry, and registers all
 * commands + callback query handlers onto it.
 *
 * Anatomy of a bot handler:
 *  - Commands (/start, /list, /help, etc.)
 *  - Callback queries from inline keyboards (button taps)
 *  - Text message handler (incart bot: URL paste)
 *
 * The customer bot NEVER emits shoe.url (producer-URL redaction boundary).
 * Work bots verify the allowlist via guardAllowlist before every command AND
 * every callback query — including per-size selection callbacks.
 *
 * Phase 2: work bots now have per-size drill-down multi-select.
 * In-cart bot prompts operator to add sizes after shoe creation.
 * Ops bot /logistics is a full per-size drill-down.
 *
 * ---------------------------------------------------------------------------
 * Stateless multi-select keyboard design
 * ---------------------------------------------------------------------------
 * Vercel runs as serverless functions — there is no in-process session store.
 * We encode multi-select state IN the inline keyboard itself:
 *
 *   - An unselected size button shows:  "US 9"      callback: sz:{shoeId}:9
 *   - A selected size button shows:     "✓ US 9"    callback: sz:{shoeId}:9
 *
 * On each tap, the handler reads ctx.callbackQuery.message.reply_markup
 * (the live keyboard from Telegram), flips the ✓ prefix on the tapped size,
 * and calls editMessageReplyMarkup — no DB round-trip, no session needed.
 *
 * "Advance selected" (go:{shoeId}) parses the keyboard text to find all
 * buttons whose label starts with "✓" and calls setSizeStatus for each.
 *
 * "Advance all" (szall:{shoeId}) re-fetches eligible sizes from the DB and
 * calls advanceAllSizes for all of them.
 *
 * ---------------------------------------------------------------------------
 * Callback data scheme (all values ≤ 64 bytes per Telegram limits)
 * ---------------------------------------------------------------------------
 * Work bots:
 *   pick:{shoeId}           — shoe selected from list → show size toggle keyboard
 *   sz:{shoeId}:{usSize}    — toggle one size (flip ✓)
 *   go:{shoeId}             — advance ✓-selected sizes
 *   szall:{shoeId}          — advance ALL eligible sizes
 *
 * In-cart bot (size-add after shoe creation):
 *   ic_sz:{shoeId}:{usSize} — toggle a size for the new shoe
 *   ic_done:{shoeId}        — confirm selected sizes → addSize + setSizeStatus
 *   ic_skip:{shoeId}        — skip size selection (add sizes via /admin later)
 *
 * Ops bot:
 *   ops_log_pick:{shoeId}              — shoe selected
 *   ops_log_sz:{shoeId}:{usSize}       — size selected → show status picker
 *   ops_log_st:{shoeId}:{usSize}:{st}  — set status (or "null" to clear)
 *   ops_sales_pick:{shoeId}            — sales: shoe selected
 *   ops_sales_set:{shoeId}:{status}    — sales: set status
 *
 * Ops bot — Phase B website-editing commands (admin-gated):
 *   /edit:
 *     edit_pick:{shoeId}               — shoe selected → field menu
 *     edit_fld:{shoeId}:{field}        — field chosen (title|brand|price|notes
 *                                        |sizes|sales); text fields send a
 *                                        ForceReply whose text ENCODES the
 *                                        target (stateless free-text capture)
 *     edit_sales:{shoeId}:{status}     — set sales status (upcoming/available/sold)
 *   /remove:
 *     rm_pick:{shoeId}                 — shoe selected → confirm
 *     rm_yes:{shoeId} / rm_no          — confirm / cancel soft-remove
 *   /copy:
 *     cp_key:{key}                     — copy key selected → EN/AM
 *     cp_lang:{key}:{lang}             — language chosen → ForceReply for value
 *
 * Ops bot — storefront-redesign commands (admin-gated):
 *   /setprice:
 *     setp_pick:{shoeId}               — shoe selected → ForceReply for the birr
 *                                        amount ([setprice:{shoeId}] tag)
 *   video upload (admin sends a video → shoe picker replies to it):
 *     vid_pick:{shoeId}                — shoe selected → read the video from the
 *                                        picker's reply_to_message, download via
 *                                        getFile, upload to the 'shoe-videos'
 *                                        bucket, setVideoUrl
 *   /clearvideo:
 *     vidclr_pick:{shoeId}             — shoe selected → clear video_url
 *
 * Stateless free-text capture (no session store): /edit text fields, /copy and
 * /setprice send a ForceReply whose visible text embeds a parseable tag, e.g.
 *   "✏️ New price for <title> [id:<shoeId>] — reply with the value"
 *   "📝 New section_available (en) — reply with the value [copy:section_available:en]"
 *   "💵 New price (birr) for <title> — ... [setprice:<shoeId>]"
 * The ops-bot message:text handler matches replies via reply_to_message.text,
 * parses the tag, and dispatches. This is the only ops-bot message:text handler.
 *
 * Stateless video capture: an admin-sent video has no callback_data budget for
 * the file_id, so the shoe-picker message is sent as a REPLY to the video; the
 * vid_pick handler recovers the file_id from
 * ctx.callbackQuery.message.reply_to_message.video (or .document).
 *
 * UUID shoeId is 36 chars; longest usSize is "10.5" (4 chars); longest status
 * is "delivered" (9 chars). Longest callback: ops_log_st:36:4:9 = 56 bytes.
 * Phase B longest: edit_sales:36:9 = 57 bytes; cp_lang:18:2 = 29 bytes.
 * Redesign longest: vidclr_pick:36 = 48 bytes.
 *
 * Photo-match (work bots):
 *   phm:{shoeId}    — confirm photo match → advance all eligible sizes
 *   phm_no          — reject all photo-match candidates
 * Photo-match longest: phm:36 = 40 bytes.
 */

import { Bot, Context, InlineKeyboard } from "grammy";
import type { InlineKeyboardButton } from "@grammyjs/types";
import type { BotEntry } from "./registry";
import { checkAllowlist } from "./auth";
import {
  getPublicShoes,
  getShoesByLogistics,
  getAllShoes,
  createShoeFromUrl,
  getShoeSizes,
  setSizeStatus,
  addSize,
  advanceAllSizes,
  setSalesStatus,
  syncSizesFromText,
  updateShoeField,
  setPriceEtb,
  setVideoUrl,
  softRemoveShoe,
  STATUSES,
  LOGISTICS,
} from "@/lib/shoes";
import { uploadShoeVideo } from "@/lib/storage";
import type { FeedMeta, EditableShoeField } from "@/lib/shoes";
import { getSiteCopy, getCopy, setCopy } from "@/lib/site-copy";
import type { SiteCopyKey, SiteCopyLang } from "@/lib/site-copy";
import { parseOwnerIntent } from "@/lib/site-edit-nl";
import type { OwnerIntent } from "@/lib/site-edit-nl";
import { matchPhotoToShoes } from "@/lib/shoe-matcher";
import { SIZE_GRID } from "@/lib/sizes";
import type { Shoe, LogisticsStatus, ShoeStatus, ShoeSize } from "@/lib/supabase";
import { supabaseService } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Helper — build FeedMeta from a grammY Context + bot entry name.
// ---------------------------------------------------------------------------

function botMeta(ctx: Context, botName: string): FeedMeta {
  const username = ctx.from?.username;
  const firstName = ctx.from?.first_name;
  const actorLabel = username ? `@${username}` : (firstName ?? `tg:${ctx.from?.id}`);
  return { actorLabel, source: botName };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatShoe(s: Shoe | Omit<Shoe, "url">, includeUrl = false): string {
  const parts: string[] = [];
  parts.push(`*${escMd(s.title)}*`);
  if (s.brand) parts.push(`Brand: ${escMd(s.brand)}`);
  if (s.price_usd != null) parts.push(`Price: $${s.price_usd}`);
  if (s.status) parts.push(`Sales: ${escMd(s.status)}`);
  // Show per-size summary if available.
  const szs = s.shoe_sizes;
  if (szs && szs.length > 0) {
    const summary = szs.map((sz) => `${sz.us_size}:${sz.logistics_status ?? "—"}`).join(", ");
    parts.push(`Sizes: ${escMd(summary)}`);
  }
  if (includeUrl && "url" in s && s.url) parts.push(`URL: ${s.url}`);
  return parts.join("\n");
}

/** Escape special characters for Telegram MarkdownV2. */
function escMd(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Tier-2 natural-language confirmation helpers (ops bot).
//
// An LLM-derived command is NEVER executed without an explicit Yes tap. The
// confirmation message embeds the full structured command as a base64 tag
// ([nl:<b64>]) in its visible text, mirroring the stateless [edit:...]/[copy:...]
// ForceReply convention — there is no server-side session store (Vercel is
// serverless). The Yes/No callback_data is tiny (`nl_yes` / `nl_no`); the Yes
// handler reads the command back out of ctx.callbackQuery.message.text.
// ---------------------------------------------------------------------------

/** A confirmable Tier-2 command (the LLM intent minus clarify/error). */
type NlCommand = Extract<OwnerIntent, { command: string }>;

/** Encode a confirmed command as a base64 tag for embedding in message text. */
function encodeNlTag(cmd: NlCommand): string {
  const b64 = Buffer.from(JSON.stringify(cmd), "utf8").toString("base64");
  return `[nl:${b64}]`;
}

/** Recover a command from a confirmation message's text. Null if absent/bad. */
function decodeNlTag(text: string | undefined): NlCommand | null {
  if (!text) return null;
  const m = text.match(/\[nl:([A-Za-z0-9+/=]+)\]/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
    if (parsed && typeof parsed.command === "string") return parsed as NlCommand;
    return null;
  } catch {
    return null;
  }
}

/** Human-readable, one-line description of a Tier-2 command for the prompt. */
function summarizeNlCommand(cmd: NlCommand, shoeTitleById: Map<string, string>): string {
  switch (cmd.command) {
    case "edit_field": {
      const title = shoeTitleById.get(cmd.args.shoe_id) ?? cmd.args.shoe_id;
      const label = cmd.args.field === "price_usd" ? "price" : cmd.args.field;
      return `Set ${label} of "${title}" to "${cmd.args.value}"`;
    }
    case "set_sales": {
      const title = shoeTitleById.get(cmd.args.shoe_id) ?? cmd.args.shoe_id;
      return `Set sales status of "${title}" to "${cmd.args.status}"`;
    }
    case "set_copy":
      return `Set website copy "${cmd.args.key}" (${cmd.args.lang}) to "${cmd.args.value}"`;
    case "remove_shoe": {
      const title = shoeTitleById.get(cmd.args.shoe_id) ?? cmd.args.shoe_id;
      return `Remove "${title}" (hide from the storefront)`;
    }
    case "set_price_etb": {
      const title = shoeTitleById.get(cmd.args.shoe_id) ?? cmd.args.shoe_id;
      return cmd.args.price_etb === null
        ? `Clear the birr price of "${title}"`
        : `Set the price of "${title}" to ብር ${cmd.args.price_etb}`;
    }
    case "clear_video": {
      const title = shoeTitleById.get(cmd.args.shoe_id) ?? cmd.args.shoe_id;
      return `Clear the video of "${title}"`;
    }
  }
}

async function guardAllowlist(
  ctx: Context,
  botName: string,
  requiredRole: "purchaser" | "shipper" | "admin"
): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    await ctx.reply("Could not identify your Telegram account.");
    return false;
  }
  const result = await checkAllowlist(telegramId, botName, requiredRole);
  if (!result.allowed) {
    await ctx.reply(
      `Access denied: ${result.reason}\n\nYour Telegram ID: ${telegramId}`
    );
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Stateless multi-select keyboard helpers
// ---------------------------------------------------------------------------

/** Prefix prepended to selected size button labels. */
const CHECK = "✓ ";

/**
 * Build a size-toggle keyboard for work bots.
 * All eligible sizes start unselected.
 * Two action buttons at the bottom: "Advance selected" and "Advance all".
 * Up to 4 size buttons per row.
 */
function buildSizeToggleKb(
  shoeId: string,
  eligibleSizes: ShoeSize[]
): InlineKeyboard {
  const kb = new InlineKeyboard();
  eligibleSizes.forEach((sz, i) => {
    kb.text(`US ${sz.us_size}`, `sz:${shoeId}:${sz.us_size}`);
    if ((i + 1) % 4 === 0) kb.row();
  });
  kb.row();
  kb.text("Advance selected", `go:${shoeId}`).text("Advance all", `szall:${shoeId}`);
  return kb;
}

/**
 * Build the size-selection keyboard for the in-cart bot after shoe creation.
 * Shows the full SIZE_GRID; all sizes start unselected.
 * "Add selected sizes" and "Skip" at the bottom.
 */
function buildIncartSizeKb(shoeId: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  SIZE_GRID.forEach((e, i) => {
    kb.text(`US ${e.us}`, `ic_sz:${shoeId}:${e.us}`);
    if ((i + 1) % 4 === 0) kb.row();
  });
  kb.row();
  kb.text("Add selected sizes", `ic_done:${shoeId}`).text("Skip (add later)", `ic_skip:${shoeId}`);
  return kb;
}

/**
 * Rebuild an existing inline keyboard by flipping the ✓ prefix on the button
 * whose callback_data matches `toggleCallback`.
 *
 * This is the core of the stateless multi-select: we read the live keyboard
 * from Telegram (which carries the current selection state), flip one button,
 * and write it back via editMessageReplyMarkup — no server-side session needed.
 *
 * @param existingRows  The inline_keyboard rows from the live message markup.
 * @param toggleCallback  The callback_data string of the button to flip.
 */
function toggleButtonInKb(
  existingRows: InlineKeyboardButton[][],
  toggleCallback: string
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let r = 0; r < existingRows.length; r++) {
    const row = existingRows[r];
    for (let c = 0; c < row.length; c++) {
      const btn = row[c];
      if (!("callback_data" in btn)) {
        // Non-callback button (URL etc) — pass through as text with empty cb.
        kb.text(btn.text, "noop");
        continue;
      }
      if (btn.callback_data === toggleCallback) {
        const newText = btn.text.startsWith(CHECK)
          ? btn.text.slice(CHECK.length)
          : CHECK + btn.text;
        kb.text(newText, btn.callback_data);
      } else {
        kb.text(btn.text, btn.callback_data);
      }
      // Stay on the same row until all columns processed.
    }
    if (r < existingRows.length - 1) kb.row();
  }
  return kb;
}

/**
 * Parse the existing keyboard to extract all ✓-selected US sizes.
 * A size button is considered selected iff its text starts with CHECK AND
 * its text contains "US " (action buttons like "Advance selected" are ignored).
 * Works for both sz: (work bots) and ic_sz: (in-cart bot) prefixes.
 */
function getSelectedSizes(rows: InlineKeyboardButton[][]): string[] {
  const selected: string[] = [];
  for (const row of rows) {
    for (const btn of row) {
      if (!("callback_data" in btn)) continue;
      if (!btn.text.includes("US ")) continue; // skip action buttons
      if (btn.text.startsWith(CHECK)) {
        // "✓ US 9" → strip CHECK → "US 9" → strip "US " → "9"
        const size = btn.text.slice(CHECK.length).replace(/^US /, "");
        selected.push(size);
      }
    }
  }
  return selected;
}

// ---------------------------------------------------------------------------
// Customer bot — public browse, NO url emitted
// ---------------------------------------------------------------------------

export function registerCustomerBot(bot: Bot, _entry: BotEntry) {
  bot.command("start", async (ctx) => {
    const kb = new InlineKeyboard()
      .text("Available now", "list:available")
      .row()
      .text("Coming soon", "list:upcoming");
    await ctx.reply(
      "Welcome to Berebaso! Browse our sneaker collection:",
      { reply_markup: kb }
    );
  });

  bot.command("available", (ctx) =>
    ctx.reply("Use /start to browse.", {
      reply_markup: new InlineKeyboard().text("Available now", "list:available"),
    })
  );

  bot.command("upcoming", (ctx) =>
    ctx.reply("Use /start to browse.", {
      reply_markup: new InlineKeyboard().text("Coming soon", "list:upcoming"),
    })
  );

  bot.command("help", (ctx) =>
    ctx.reply(
      "Commands:\n/start — browse the collection\n/available — available shoes\n/upcoming — coming soon"
    )
  );

  bot.callbackQuery(/^list:(available|upcoming|sold)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const status = ctx.match[1] as ShoeStatus;
    const { shoes, error } = await getPublicShoes({ status });
    if (error) {
      await ctx.reply("Error fetching shoes. Please try again.");
      return;
    }
    if (shoes.length === 0) {
      await ctx.editMessageText(
        status === "available"
          ? "No shoes available right now. Check back soon!"
          : "Nothing coming soon at the moment."
      );
      return;
    }
    const label = status === "available" ? "Available now" : "Coming soon";
    const lines = shoes.map((s) => {
      // Customers only ever see the admin-set birr price — never USD.
      const price = s.price_etb != null ? ` — ብር ${s.price_etb}` : "";
      const brand = s.brand ? `[${s.brand}] ` : "";
      return `• ${brand}${s.title}${price}`;
    });
    const text =
      `*${escMd(label)}* (${shoes.length})\n\n` + lines.map(escMd).join("\n");
    const kb = new InlineKeyboard()
      .text("Available now", "list:available")
      .row()
      .text("Coming soon", "list:upcoming");
    await ctx.editMessageText(text, {
      parse_mode: "MarkdownV2",
      reply_markup: kb,
    });
  });
}

// ---------------------------------------------------------------------------
// In-cart bot — paste a URL to create a shoe + select which sizes to add
// ---------------------------------------------------------------------------

export function registerIncartBot(bot: Bot, entry: BotEntry) {
  bot.command("start", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "shipper"))) return;
    await ctx.reply(
      "In-cart bot. Paste a product URL to add a shoe to the in-cart queue.\n" +
        "After creation you will be prompted to select which sizes to add."
    );
  });

  bot.command("help", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "shipper"))) return;
    await ctx.reply(
      "Paste any retailer product URL and I will scrape it and create a shoe.\n" +
        "You will then pick the sizes to add (set to in_cart).\n" +
        "Tap 'Skip' to add sizes later via /admin."
    );
  });

  bot.on("message:text", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "shipper"))) return;
    const text = ctx.message.text.trim();
    if (!/^https?:\/\//i.test(text)) {
      await ctx.reply("Please paste a full URL (starting with https://).");
      return;
    }
    const msg = await ctx.reply("Scraping...");
    const result = await createShoeFromUrl({
      url: text,
      logistics_status: "in_cart",
      meta: botMeta(ctx, entry.name),
    });
    if (result.error || !result.shoe) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        msg.message_id,
        `Error: ${result.error ?? "unknown error"}`
      );
      return;
    }
    const shoe = result.shoe;
    const brandLine = shoe.brand ? `\nBrand: ${escMd(shoe.brand)}` : "";
    const priceLine = shoe.price_usd != null ? `\nPrice: \\$${shoe.price_usd}` : "";
    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      `Shoe added:\n\n*${escMd(shoe.title)}*${brandLine}${priceLine}\n\nTap sizes to select them \\(they will be set to in\\_cart\\), then tap "Add selected sizes"\\.`,
      {
        parse_mode: "MarkdownV2",
        reply_markup: buildIncartSizeKb(shoe.id),
      }
    );
  });

  // Toggle a size in the in-cart size picker.
  bot.callbackQuery(/^ic_sz:([^:]+):(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "shipper"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const existingRows = ctx.callbackQuery.message?.reply_markup?.inline_keyboard ?? [];
    const newKb = toggleButtonInKb(existingRows, ctx.callbackQuery.data);
    await ctx.editMessageReplyMarkup({ reply_markup: newKb });
  });

  // Confirm: add ✓-selected sizes to the shoe and set them to in_cart.
  bot.callbackQuery(/^ic_done:(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "shipper"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const existingRows = ctx.callbackQuery.message?.reply_markup?.inline_keyboard ?? [];
    const selectedSizes = getSelectedSizes(existingRows);
    if (selectedSizes.length === 0) {
      await ctx.reply(
        "No sizes selected. Tap sizes to select them, or use 'Skip' to add sizes later via /admin."
      );
      return;
    }
    const errors: string[] = [];
    for (const sz of selectedSizes) {
      const addResult = await addSize(shoeId, sz);
      if (addResult.error) {
        errors.push(`US ${sz}: ${addResult.error}`);
        continue;
      }
      const statusResult = await setSizeStatus(shoeId, sz, "in_cart", botMeta(ctx, entry.name));
      if (statusResult.error) errors.push(`US ${sz}: ${statusResult.error}`);
    }
    const sizeList = selectedSizes.map((s) => `US ${s}`).join(", ");
    if (errors.length > 0) {
      await ctx.reply(
        `Added ${selectedSizes.length - errors.length} size(s) to in-cart. Errors:\n${errors.join("\n")}`
      );
    } else {
      await ctx.reply(`Done! ${sizeList} added and set to in_cart.`);
    }
    // Remove the size picker keyboard.
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  });

  // Skip: dismiss the size picker without adding any sizes.
  bot.callbackQuery(/^ic_skip:(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "shipper"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery("Sizes skipped — add them in /admin.");
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  });
}

// ---------------------------------------------------------------------------
// Generic work-bot factory — covers purchaser, arrived, delivery
//
// Phase 2: per-size drill-down multi-select.
//   /list → shoes with ≥1 size at fromStatus → tap shoe → size toggle keyboard
//   → ✓ mark sizes → "Advance selected" (only marked) or "Advance all"
// ---------------------------------------------------------------------------

type WorkBotConfig = {
  fromStatus: LogisticsStatus;
  toStatus: LogisticsStatus;
  listLabel: string;
};

const WORK_BOT_CONFIGS: Record<string, WorkBotConfig> = {
  purchaser: {
    fromStatus: "in_cart",
    toStatus: "purchased",
    listLabel: "Shoes with in-cart sizes (ready to purchase)",
  },
  arrived: {
    fromStatus: "purchased",
    toStatus: "arrived",
    listLabel: "Purchased shoes (awaiting arrival)",
  },
  delivery: {
    fromStatus: "arrived",
    toStatus: "delivered",
    listLabel: "Arrived shoes (ready for delivery)",
  },
};

export function registerWorkBot(bot: Bot, entry: BotEntry) {
  const config = WORK_BOT_CONFIGS[entry.name];
  if (!config) throw new Error(`No work-bot config for: ${entry.name}`);

  // Derive the required role from the registry entry so each work bot enforces
  // its own role. The purchaser bot requires "purchaser"; arrived/delivery
  // require "shipper". Cast is safe — work bots never use "public".
  const workRole = entry.role as "purchaser" | "shipper" | "admin";

  /** Build the shoe-list keyboard (one button per shoe, paginated to 20). */
  function buildShoeListKb(shoes: Array<Shoe | Omit<Shoe, "url">>): InlineKeyboard {
    const kb = new InlineKeyboard();
    shoes.slice(0, 20).forEach((s) => {
      const brand = s.brand ? `[${s.brand}] ` : "";
      const label = `${brand}${s.title}`.slice(0, 40);
      kb.text(label, `pick:${s.id}`).row();
    });
    return kb;
  }

  async function listAndShow(ctx: Context) {
    if (!(await guardAllowlist(ctx, entry.name, workRole))) return;
    const { shoes, error } = await getShoesByLogistics(config.fromStatus);
    if (error) {
      await ctx.reply("Error fetching shoes.");
      return;
    }
    if (shoes.length === 0) {
      await ctx.reply(`No shoes with any size at "${config.fromStatus}" right now.`);
      return;
    }
    await ctx.reply(
      `${config.listLabel} (${shoes.length})\nTap a shoe to select which sizes to advance:`,
      { reply_markup: buildShoeListKb(shoes) }
    );
  }

  bot.command("start", listAndShow);
  bot.command("list", listAndShow);

  bot.command("whoami", async (ctx) => {
    await ctx.reply(
      `Your Telegram ID: ${ctx.from?.id ?? "unknown"}\nUsername: @${ctx.from?.username ?? "none"}`
    );
  });

  bot.command("help", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, workRole))) return;
    const extraCommands = entry.name === "purchaser"
      ? "\n/pending — list draft Purchase Orders awaiting approval"
      : "";
    await ctx.reply(
      `${entry.description}\n\n` +
        `Use /list to see ${config.listLabel.toLowerCase()}.\n` +
        `Tap a shoe → tap sizes to select → "Advance selected" (only those) or "Advance all".`
    );
  });

  // -------------------------------------------------------------------------
  // Purchaser-bot only: /pending — PO approval UX (Phase 2).
  //
  // Lists draft Purchase Orders with inline Approve/Decline buttons.
  // Approve: flips draft→open, sets expires_at (~30 min), records approved_by.
  // Decline: sets status→cancelled.
  //
  // guardAllowlist is re-verified on every callback tap.
  // -------------------------------------------------------------------------
  if (entry.name === "purchaser") {
    bot.command("pending", async (ctx) => {
      if (!(await guardAllowlist(ctx, entry.name, workRole))) return;

      const db = supabaseService();
      const { data, error } = await db
        .from("purchase_orders")
        .select("id, retailer_domain, max_amount_cents, size_ids, created_at")
        .eq("status", "draft")
        .order("created_at", { ascending: true })
        .limit(10);

      if (error) {
        await ctx.reply("Error fetching pending POs.");
        return;
      }

      const pos = (data as {
        id: string;
        retailer_domain: string | null;
        max_amount_cents: number;
        size_ids: string[];
        created_at: string;
      }[]) ?? [];

      if (pos.length === 0) {
        await ctx.reply("No draft Purchase Orders pending approval.");
        return;
      }

      for (const po of pos) {
        const retailer = po.retailer_domain ?? "unknown retailer";
        const maxDollars = (po.max_amount_cents / 100).toFixed(2);
        const sizeCount = po.size_ids?.length ?? 0;
        const label = `PO ${po.id.slice(0, 8)} — ${retailer} — $${maxDollars} — ${sizeCount} size(s)`;

        const kb = new InlineKeyboard()
          .text("Approve", `po_approve:${po.id}`)
          .text("Decline", `po_decline:${po.id}`);

        await ctx.reply(
          `*Draft PO*\nRetailer: ${escMd(retailer)}\nMax spend: $${escMd(maxDollars)}\nSizes: ${sizeCount}\nID: \`${escMd(po.id.slice(0, 8))}\``,
          { parse_mode: "MarkdownV2", reply_markup: kb }
        );
        void label; // referenced above for context
      }
    });

    // Approve callback
    bot.callbackQuery(/^po_approve:(.+)$/, async (ctx) => {
      // Re-verify the tapper is still a purchaser on every callback.
      if (!(await guardAllowlist(ctx, entry.name, workRole))) {
        await ctx.answerCallbackQuery("Access denied.");
        return;
      }
      await ctx.answerCallbackQuery();

      const poId = ctx.match[1];
      const telegramId = ctx.from?.id;
      if (!telegramId) {
        await ctx.reply("Cannot identify your Telegram account.");
        return;
      }

      // Set expires_at to 30 minutes from now.
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      const db = supabaseService();
      const { data, error } = await db
        .from("purchase_orders")
        .update({
          status: "open",
          approved_by: telegramId,
          approved_at: new Date().toISOString(),
          expires_at: expiresAt,
        })
        .eq("id", poId)
        .eq("status", "draft") // Optimistic guard: only approve from draft state.
        .select("id, retailer_domain, max_amount_cents")
        .maybeSingle();

      if (error || !data) {
        await ctx.reply(
          error
            ? `Error approving PO: ${error.message}`
            : "PO not found or already processed."
        );
        return;
      }

      const approved = data as { id: string; retailer_domain: string | null; max_amount_cents: number };
      const maxDollars = (approved.max_amount_cents / 100).toFixed(2);
      await ctx.reply(
        `PO approved. The agent may now spend up to $${maxDollars} at ${approved.retailer_domain ?? "the retailer"}. Expires in 30 min.`
      );
    });

    // Decline callback
    bot.callbackQuery(/^po_decline:(.+)$/, async (ctx) => {
      if (!(await guardAllowlist(ctx, entry.name, workRole))) {
        await ctx.answerCallbackQuery("Access denied.");
        return;
      }
      await ctx.answerCallbackQuery();

      const poId = ctx.match[1];
      const db = supabaseService();
      const { data, error } = await db
        .from("purchase_orders")
        .update({ status: "cancelled" })
        .eq("id", poId)
        .eq("status", "draft")
        .select("id")
        .maybeSingle();

      if (error || !data) {
        await ctx.reply(
          error ? `Error declining PO: ${error.message}` : "PO not found or already processed."
        );
        return;
      }

      await ctx.reply("PO declined and cancelled.");
    });
  }

  // Shoe tapped → show its eligible sizes as a toggle keyboard.
  bot.callbackQuery(/^pick:(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, workRole))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const { sizes, error } = await getShoeSizes(shoeId);
    if (error) {
      await ctx.reply(`Error fetching sizes: ${error}`);
      return;
    }
    const eligible = sizes.filter((sz) => sz.logistics_status === config.fromStatus);
    if (eligible.length === 0) {
      await ctx.reply(
        `No sizes at "${config.fromStatus}" for that shoe. Check /admin for current status.`
      );
      return;
    }
    await ctx.reply(
      `Tap sizes to select, then choose an action:`,
      { reply_markup: buildSizeToggleKb(shoeId, eligible) }
    );
  });

  // Size button tapped → flip its ✓ in the keyboard (stateless toggle).
  bot.callbackQuery(/^sz:([^:]+):(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, workRole))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const existingRows = ctx.callbackQuery.message?.reply_markup?.inline_keyboard ?? [];
    const newKb = toggleButtonInKb(existingRows, ctx.callbackQuery.data);
    await ctx.editMessageReplyMarkup({ reply_markup: newKb });
  });

  // "Advance selected" — advance only the ✓-marked sizes.
  bot.callbackQuery(/^go:(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, workRole))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const existingRows = ctx.callbackQuery.message?.reply_markup?.inline_keyboard ?? [];
    const selectedSizes = getSelectedSizes(existingRows);
    if (selectedSizes.length === 0) {
      await ctx.reply("No sizes selected. Tap sizes to mark them, or use 'Advance all'.");
      return;
    }
    const errors: string[] = [];
    for (const sz of selectedSizes) {
      const result = await setSizeStatus(shoeId, sz, config.toStatus, botMeta(ctx, entry.name));
      if (result.error) errors.push(`US ${sz}: ${result.error}`);
    }
    const sizeList = selectedSizes.map((s) => `US ${s}`).join(", ");
    if (errors.length > 0) {
      await ctx.reply(
        `Advanced ${selectedSizes.length - errors.length} size(s) to ${config.toStatus}. Errors:\n${errors.join("\n")}`
      );
    } else {
      await ctx.reply(`Done! ${sizeList} → ${config.toStatus}`);
    }
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  });

  // "Advance all" — advance every eligible size at fromStatus.
  bot.callbackQuery(/^szall:(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, workRole))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const result = await advanceAllSizes(shoeId, config.toStatus, botMeta(ctx, entry.name));
    if (result.error) {
      await ctx.reply(`Error: ${result.error}`);
      return;
    }
    if (result.count === 0) {
      await ctx.reply(
        `No sizes were at "${config.fromStatus}" for that shoe. Check /admin for current status.`
      );
      return;
    }
    await ctx.reply(
      `Done! ${result.count} size${result.count === 1 ? "" : "s"} → ${config.toStatus}`
    );
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  });

  // -------------------------------------------------------------------------
  // Photo-match flow: send a photo → AI identifies which shoe → confirm → advance.
  //
  // The user sends a photo of the shoe they just received (or are about to
  // deliver). Claude vision compares it against all shoes with sizes at
  // config.fromStatus and returns ranked matches. The operator confirms by
  // tapping an inline button, which calls advanceAllSizes for that shoe.
  //
  // Callback scheme:
  //   phm:{shoeId}   — confirmed match → advance all eligible sizes
  //   phm_no         — no match, fall back to manual /list
  // -------------------------------------------------------------------------
  bot.on("message:photo", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, workRole))) return;

    // Get candidate shoes with sizes at fromStatus.
    const { shoes: candidates, error: fetchError } = await getShoesByLogistics(
      config.fromStatus
    );
    if (fetchError) {
      await ctx.reply("Error fetching candidate shoes. Please try again.");
      return;
    }
    if (candidates.length === 0) {
      await ctx.reply(
        `No shoes with sizes at "${config.fromStatus}". Nothing to match.`
      );
      return;
    }

    // Download the highest-resolution photo from Telegram.
    const photoSizes = ctx.message.photo;
    const largest = photoSizes[photoSizes.length - 1];
    if (!largest) {
      await ctx.reply("Could not read the photo. Please try again.");
      return;
    }

    // Send a status message while the AI processes.
    const statusMsg = await ctx.reply("Analyzing photo...");
    const done = (text: string) =>
      ctx.api
        .editMessageText(statusMsg.chat.id, statusMsg.message_id, text)
        .catch(() => ctx.reply(text));

    try {
      // Download the photo via Telegram file API.
      const file = await ctx.api.getFile(largest.file_id);
      if (!file.file_path) {
        await done(
          "Telegram did not return a download path for that photo. Please try again."
        );
        return;
      }
      const photoRes = await fetch(
        `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`
      );
      if (!photoRes.ok) {
        await done(
          `Error downloading the photo from Telegram (HTTP ${photoRes.status}).`
        );
        return;
      }
      const photoBuffer = Buffer.from(await photoRes.arrayBuffer());
      const photoBase64 = photoBuffer.toString("base64");

      // Run AI matching.
      const matchResult = await matchPhotoToShoes(
        photoBase64,
        "image/jpeg",
        candidates.map((s) => ({
          id: s.id,
          title: s.title,
          brand: s.brand,
          image_url: s.image_url,
        }))
      );

      if (matchResult.error) {
        await done(`Could not match the photo: ${matchResult.error}`);
        return;
      }

      const topMatches = matchResult.matches.slice(0, 3);
      if (topMatches.length === 0) {
        await done(
          "No matching shoes found in the catalog. Use /list to manually select a shoe."
        );
        return;
      }

      // Build the confirmation keyboard.
      const kb = new InlineKeyboard();
      for (const match of topMatches) {
        const confLabel =
          match.confidence === "high"
            ? "Strong match"
            : match.confidence === "medium"
            ? "Possible match"
            : "Weak match";
        const btnLabel = `${confLabel}: ${match.title.slice(0, 35)} — advance all sizes?`;
        kb.text(btnLabel, `phm:${match.shoeId}`).row();
      }
      kb.text("None of these", "phm_no");

      await ctx.api.editMessageText(
        statusMsg.chat.id,
        statusMsg.message_id,
        `AI identified ${topMatches.length} possible match${topMatches.length === 1 ? "" : "es"}. Tap to confirm and advance all eligible sizes to "${config.toStatus}":`,
        { reply_markup: kb }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      await done(`Error during photo analysis: ${msg}`);
    }
  });

  // Confirmed match — advance all eligible sizes for the matched shoe.
  bot.callbackQuery(/^phm:(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, workRole))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const result = await advanceAllSizes(shoeId, config.toStatus, botMeta(ctx, entry.name));
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    if (result.error) {
      await ctx.reply(`Error advancing sizes: ${result.error}`);
      return;
    }
    if (result.count === 0) {
      await ctx.reply(
        `No sizes were at "${config.fromStatus}" for that shoe. Check /admin for the current status.`
      );
      return;
    }
    await ctx.reply(
      `Done! ${result.count} size${result.count === 1 ? "" : "s"} → ${config.toStatus}`
    );
  });

  // Rejected — tell the user to fall back to manual selection.
  bot.callbackQuery(/^phm_no$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, workRole))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery("Match rejected.");
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    await ctx.reply(
      "No match confirmed. Use /list to manually select a shoe."
    );
  });
}

// ---------------------------------------------------------------------------
// Owner ops bot — full control
//
// Phase 2: /logistics is a full per-size drill-down:
//   Pick shoe → pick size → pick new status (incl. "clear"/null) → setSizeStatus
// ---------------------------------------------------------------------------

export function registerOpsBot(bot: Bot, entry: BotEntry) {
  bot.command("start", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) return;
    await ctx.reply(
      "Berebaso ops bot.\n\nCommands:\n" +
        "/list — full pipeline overview\n" +
        "/whoami — your Telegram ID\n" +
        "/sales — manage sales status\n" +
        "/logistics — per-size drill-down: pick shoe → size → status\n" +
        "/edit — edit a shoe (title, brand, price, sizes, notes, sales status)\n" +
        "/setprice — set the customer-facing birr price for a shoe\n" +
        "/clearvideo — remove a shoe's hands-on video\n" +
        "/remove — hide a shoe from the storefront\n" +
        "/copy — edit website copy (hero, sections, footer)\n" +
        "/help — this message\n\n" +
        "Send a video (up to ~19MB) to attach it to a shoe.\n\n" +
        "Tip: when enabled, you can also just type a plain instruction " +
        '(e.g. "mark the Jordan 1s as sold") and confirm the change.'
    );
  });

  bot.command("whoami", async (ctx) => {
    await ctx.reply(
      `Your Telegram ID: ${ctx.from?.id ?? "unknown"}\nUsername: @${ctx.from?.username ?? "none"}`
    );
  });

  bot.command("help", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) return;
    await ctx.reply(
      "Ops bot commands:\n" +
        "/list — full pipeline\n" +
        "/whoami — get your Telegram ID\n" +
        "/sales — change sales status\n" +
        "/logistics — per-size drill-down: pick shoe → pick size → pick status (or clear)\n" +
        "/edit — pick a shoe → edit title, brand, price, sizes, notes, or sales status\n" +
        "/setprice — pick a shoe → reply with the birr amount (or \"none\" to clear)\n" +
        "/clearvideo — pick a shoe → remove its hands-on video\n" +
        "/remove — pick a shoe → confirm → hide it from the storefront (soft-remove)\n" +
        "/copy — edit website copy: pick a key → EN/AM → reply with the new value\n" +
        "Send a video (up to ~19MB) → pick the shoe → it's attached to the storefront\n" +
        "Plain text — when natural-language editing is enabled, type an instruction " +
        "(e.g. \"set the price of the Dunks to 18500 birr\") and confirm before it applies"
    );
  });

  bot.command("list", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) return;
    const { shoes, error } = await getAllShoes();
    if (error) {
      await ctx.reply("Error fetching shoes.");
      return;
    }
    if (shoes.length === 0) {
      await ctx.reply("No shoes in the database.");
      return;
    }
    const lines = shoes.map((s) => {
      const szs = s.shoe_sizes ?? [];
      const logSummary =
        szs.length > 0
          ? szs.map((sz) => `${sz.us_size}:${sz.logistics_status ?? "—"}`).join(", ")
          : "no sizes";
      return `• [${s.status}] ${s.title.slice(0, 50)} — ${logSummary}`;
    });
    await ctx.reply(`Pipeline (${shoes.length} shoes):\n\n` + lines.join("\n"));
  });

  // /sales — list shoes → tap → pick new sales status
  bot.command("sales", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) return;
    const { shoes, error } = await getAllShoes();
    if (error) {
      await ctx.reply("Error fetching shoes.");
      return;
    }
    if (shoes.length === 0) {
      await ctx.reply("No shoes.");
      return;
    }
    const kb = new InlineKeyboard();
    shoes.slice(0, 20).forEach((s) => {
      const label = `${s.title.slice(0, 35)} [${s.status}]`;
      kb.text(label, `ops_sales_pick:${s.id}`).row();
    });
    await ctx.reply("Pick a shoe to change its sales status:", { reply_markup: kb });
  });

  bot.callbackQuery(/^ops_sales_pick:(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const kb = new InlineKeyboard();
    STATUSES.forEach((s) => kb.text(s, `ops_sales_set:${shoeId}:${s}`).row());
    await ctx.reply("Choose new sales status:", { reply_markup: kb });
  });

  bot.callbackQuery(/^ops_sales_set:([^:]+):(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const newStatus = ctx.match[2] as ShoeStatus;
    const result = await setSalesStatus(shoeId, newStatus, botMeta(ctx, entry.name));
    if (result.error) {
      await ctx.reply(`Error: ${result.error}`);
      return;
    }
    await ctx.reply(
      `Sales status set to *${escMd(newStatus)}* for "${escMd(result.shoe!.title)}"`,
      { parse_mode: "MarkdownV2" }
    );
  });

  // /logistics — drill-down: pick shoe → pick size → pick status
  bot.command("logistics", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) return;
    const { shoes, error } = await getAllShoes();
    if (error) {
      await ctx.reply("Error fetching shoes.");
      return;
    }
    if (shoes.length === 0) {
      await ctx.reply("No shoes.");
      return;
    }
    const kb = new InlineKeyboard();
    shoes.slice(0, 20).forEach((s) => {
      const szs = s.shoe_sizes ?? [];
      const summary =
        szs.length > 0
          ? szs.map((sz) => `${sz.us_size}:${sz.logistics_status ?? "—"}`).join(", ")
          : "no sizes";
      const label = `${s.title.slice(0, 28)} [${summary.slice(0, 18)}]`;
      kb.text(label, `ops_log_pick:${s.id}`).row();
    });
    await ctx.reply("Pick a shoe to update per-size logistics status:", {
      reply_markup: kb,
    });
  });

  // Shoe selected → show its sizes (each labelled with current status).
  bot.callbackQuery(/^ops_log_pick:(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const { sizes, error } = await getShoeSizes(shoeId);
    if (error) {
      await ctx.reply(`Error fetching sizes: ${error}`);
      return;
    }
    if (sizes.length === 0) {
      await ctx.reply("This shoe has no sizes yet. Add sizes via /admin.");
      return;
    }
    const kb = new InlineKeyboard();
    sizes.forEach((sz) => {
      const statusLabel = sz.logistics_status ?? "not started";
      kb.text(`US ${sz.us_size} [${statusLabel}]`, `ops_log_sz:${shoeId}:${sz.us_size}`).row();
    });
    await ctx.reply("Pick a size to update:", { reply_markup: kb });
  });

  // Size selected → show all 4 status options + "clear".
  bot.callbackQuery(/^ops_log_sz:([^:]+):(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const usSize = ctx.match[2];
    const kb = new InlineKeyboard();
    LOGISTICS.forEach((s) => kb.text(s, `ops_log_st:${shoeId}:${usSize}:${s}`).row());
    // "null" sentinel = clear the status back to not-started.
    kb.text("clear (not started)", `ops_log_st:${shoeId}:${usSize}:null`).row();
    await ctx.reply(`Set logistics status for US ${usSize}:`, { reply_markup: kb });
  });

  // Status selected → write via setSizeStatus.
  bot.callbackQuery(/^ops_log_st:([^:]+):([^:]+):(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const usSize = ctx.match[2];
    const rawStatus = ctx.match[3];
    const toStatus: LogisticsStatus | null =
      rawStatus === "null" ? null : (rawStatus as LogisticsStatus);
    const result = await setSizeStatus(shoeId, usSize, toStatus, botMeta(ctx, entry.name));
    if (result.error) {
      await ctx.reply(`Error: ${result.error}`);
      return;
    }
    const label = toStatus ?? "cleared (not started)";
    await ctx.reply(`US ${usSize} → ${label}`);
  });

  // -------------------------------------------------------------------------
  // Phase B — website-editing commands: /edit, /remove, /copy.
  //
  // Free-text values (title/brand/price/notes/sizes and copy values) are
  // captured with a stateless ForceReply: the prompt's VISIBLE text embeds a
  // parseable tag, and the message:text handler below reads
  // reply_to_message.text to recover the target. There is NO session store
  // (Vercel is serverless). This is the ONLY ops-bot message:text handler.
  // -------------------------------------------------------------------------

  // Short callback token → field. Keeps callback_data small and stable.
  const FIELD_BY_TOKEN: Record<string, EditableShoeField> = {
    title: "title",
    brand: "brand",
    price: "price_usd",
    notes: "notes",
  };
  const TOKEN_BY_FIELD: Record<EditableShoeField, string> = {
    title: "title",
    brand: "brand",
    price_usd: "price",
    notes: "notes",
  };
  // Ordered copy keys for the /copy menu (matches lib/site-copy SiteCopyKey).
  const COPY_KEYS: SiteCopyKey[] = [
    "hero_tagline",
    "section_available",
    "section_on_the_way",
    "section_coming_soon",
    "section_previously",
    "footer",
  ];

  /** Build a shoe-picker keyboard for /edit and /remove (mirrors /sales). */
  function buildShoePickerKb(
    shoes: Array<Shoe | Omit<Shoe, "url">>,
    cbPrefix: string
  ): InlineKeyboard {
    const kb = new InlineKeyboard();
    shoes.slice(0, 20).forEach((s) => {
      const label = `${s.title.slice(0, 35)} [${s.status}]`;
      kb.text(label, `${cbPrefix}:${s.id}`).row();
    });
    return kb;
  }

  // ----- /edit ------------------------------------------------------------
  bot.command("edit", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) return;
    const { shoes, error } = await getAllShoes();
    if (error) {
      await ctx.reply("Error fetching shoes.");
      return;
    }
    if (shoes.length === 0) {
      await ctx.reply("No shoes.");
      return;
    }
    await ctx.reply("Pick a shoe to edit:", {
      reply_markup: buildShoePickerKb(shoes, "edit_pick"),
    });
  });

  // Shoe selected → show the field menu.
  bot.callbackQuery(/^edit_pick:(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const kb = new InlineKeyboard()
      .text("Title", `edit_fld:${shoeId}:title`)
      .text("Brand", `edit_fld:${shoeId}:brand`)
      .row()
      .text("Price", `edit_fld:${shoeId}:price`)
      .text("Notes", `edit_fld:${shoeId}:notes`)
      .row()
      .text("Sizes", `edit_fld:${shoeId}:sizes`)
      .text("Sales status", `edit_fld:${shoeId}:sales`);
    await ctx.reply("What do you want to edit?", { reply_markup: kb });
  });

  // Field chosen → branch: text fields → ForceReply; sizes → ForceReply;
  // sales → status buttons.
  bot.callbackQuery(/^edit_fld:([^:]+):(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const fieldToken = ctx.match[2];

    // Look up the shoe title for a friendly prompt.
    const { shoes } = await getAllShoes();
    const shoe = shoes.find((s) => s.id === shoeId);
    const title = shoe?.title ?? "this shoe";

    if (fieldToken === "sales") {
      const kb = new InlineKeyboard();
      STATUSES.forEach((s) => kb.text(s, `edit_sales:${shoeId}:${s}`).row());
      await ctx.reply(`Choose new sales status for "${title}":`, {
        reply_markup: kb,
      });
      return;
    }

    if (fieldToken === "sizes") {
      // ForceReply for a free-text size list → syncSizesFromText.
      await ctx.reply(
        `📐 New size list for ${title} [id:${shoeId}] — reply with the sizes (e.g. "8, 9, 10.5"). [edit:sizes:${shoeId}]`,
        { reply_markup: { force_reply: true } }
      );
      return;
    }

    const field = FIELD_BY_TOKEN[fieldToken];
    if (!field) {
      await ctx.reply("Unknown field.");
      return;
    }
    const fieldLabel = fieldToken === "price" ? "price (USD)" : fieldToken;
    await ctx.reply(
      `✏️ New ${fieldLabel} for ${title} [id:${shoeId}] — reply with the value. [edit:${fieldToken}:${shoeId}]`,
      { reply_markup: { force_reply: true } }
    );
  });

  // Sales status chosen for a shoe (via /edit).
  bot.callbackQuery(/^edit_sales:([^:]+):(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const newStatus = ctx.match[2] as ShoeStatus;
    const result = await setSalesStatus(shoeId, newStatus, botMeta(ctx, entry.name));
    if (result.error) {
      await ctx.reply(`Error: ${result.error}`);
      return;
    }
    await ctx.reply(
      `Sales status set to *${escMd(newStatus)}* for "${escMd(result.shoe!.title)}"`,
      { parse_mode: "MarkdownV2" }
    );
  });

  // ----- /remove ----------------------------------------------------------
  bot.command("remove", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) return;
    const { shoes, error } = await getAllShoes();
    if (error) {
      await ctx.reply("Error fetching shoes.");
      return;
    }
    if (shoes.length === 0) {
      await ctx.reply("No shoes.");
      return;
    }
    await ctx.reply("Pick a shoe to remove (hide from storefront):", {
      reply_markup: buildShoePickerKb(shoes, "rm_pick"),
    });
  });

  // Shoe selected → confirm Yes/No.
  bot.callbackQuery(/^rm_pick:(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const { shoes } = await getAllShoes();
    const shoe = shoes.find((s) => s.id === shoeId);
    const title = shoe?.title ?? "this shoe";
    const kb = new InlineKeyboard()
      .text("Yes, remove", `rm_yes:${shoeId}`)
      .text("No, cancel", "rm_no");
    await ctx.reply(
      `Remove "${title}"? It will be hidden from the storefront (the record is kept).`,
      { reply_markup: kb }
    );
  });

  // Cancel.
  bot.callbackQuery(/^rm_no$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery("Cancelled.");
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    await ctx.reply("Removal cancelled.");
  });

  // Confirm → soft-remove.
  bot.callbackQuery(/^rm_yes:(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const result = await softRemoveShoe(shoeId, botMeta(ctx, entry.name));
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    if (result.error) {
      await ctx.reply(`Error: ${result.error}`);
      return;
    }
    await ctx.reply("Done — the shoe is now hidden from the storefront.");
  });

  // ----- /copy ------------------------------------------------------------
  bot.command("copy", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) return;
    const kb = new InlineKeyboard();
    COPY_KEYS.forEach((k) => kb.text(k, `cp_key:${k}`).row());
    await ctx.reply("Pick a website copy key to edit:", { reply_markup: kb });
  });

  // Copy key selected → choose language.
  bot.callbackQuery(/^cp_key:(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const key = ctx.match[1] as SiteCopyKey;
    const copy = await getSiteCopy();
    const en = getCopy(copy, key, "en");
    const am = getCopy(copy, key, "am");
    const kb = new InlineKeyboard()
      .text("English", `cp_lang:${key}:en`)
      .text("Amharic", `cp_lang:${key}:am`);
    await ctx.reply(
      `Editing "${key}".\nCurrent EN: ${en || "—"}\nCurrent AM: ${am || "—"}\n\nPick a language:`,
      { reply_markup: kb }
    );
  });

  // Language selected → ForceReply for the new value.
  bot.callbackQuery(/^cp_lang:([^:]+):(en|am)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const key = ctx.match[1] as SiteCopyKey;
    const lang = ctx.match[2] as SiteCopyLang;
    await ctx.reply(
      `📝 New value for ${key} (${lang}) — reply with the text. [copy:${key}:${lang}]`,
      { reply_markup: { force_reply: true } }
    );
  });

  // ----- /setprice — customer-facing birr price ---------------------------
  bot.command("setprice", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) return;
    const { shoes, error } = await getAllShoes();
    if (error) {
      await ctx.reply("Error fetching shoes.");
      return;
    }
    if (shoes.length === 0) {
      await ctx.reply("No shoes.");
      return;
    }
    await ctx.reply("Pick a shoe to set its birr price:", {
      reply_markup: buildShoePickerKb(shoes, "setp_pick"),
    });
  });

  // Shoe selected → ForceReply for the birr amount (stateless [setprice:] tag).
  bot.callbackQuery(/^setp_pick:(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const { shoes } = await getAllShoes();
    const shoe = shoes.find((s) => s.id === shoeId);
    const title = shoe?.title ?? "this shoe";
    const current = shoe?.price_etb != null ? `ብር ${shoe.price_etb}` : "not set";
    await ctx.reply(
      `💵 New price (birr) for ${title} — current: ${current}. Reply with a whole birr amount (e.g. 18500), or "none" to clear. [setprice:${shoeId}]`,
      { reply_markup: { force_reply: true } }
    );
  });

  // ----- Video upload — send a video, then pick the shoe -------------------
  //
  // A Telegram file_id does not fit the 64-byte callback_data budget, so the
  // shoe-picker message is sent as a REPLY to the admin's video message; the
  // vid_pick handler recovers the file from the picker's reply_to_message.

  /** Telegram's bot-API getFile cap is 20MB — stay under it with margin. */
  const MAX_VIDEO_BYTES = 19 * 1024 * 1024;
  const VIDEO_TOO_BIG_MSG =
    "That video is over Telegram's 20MB bot download limit. " +
    "Please compress or trim it to under 19MB and send it again.";

  /** Shared receive path for message:video and video-typed message:document. */
  async function handleIncomingVideo(ctx: Context, fileSize: number | undefined) {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) return;
    if (fileSize !== undefined && fileSize > MAX_VIDEO_BYTES) {
      await ctx.reply(VIDEO_TOO_BIG_MSG);
      return;
    }
    const { shoes, error } = await getAllShoes();
    if (error) {
      await ctx.reply("Error fetching shoes.");
      return;
    }
    if (shoes.length === 0) {
      await ctx.reply("No shoes to attach this video to.");
      return;
    }
    await ctx.reply("Pick the shoe to attach this video to:", {
      reply_markup: buildShoePickerKb(shoes, "vid_pick"),
      reply_parameters: { message_id: ctx.message!.message_id },
    });
  }

  bot.on("message:video", async (ctx) => {
    await handleIncomingVideo(ctx, ctx.message.video.file_size);
  });

  // Videos sent "as file" arrive as documents with a video/* mime type.
  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    if (!doc.mime_type?.startsWith("video/")) return;
    await handleIncomingVideo(ctx, doc.file_size);
  });

  // Shoe selected → download the video from Telegram, upload to the
  // 'shoe-videos' bucket (service-role only), then setVideoUrl.
  bot.callbackQuery(/^vid_pick:(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];

    // Recover the video from the picker's reply_to_message (stateless).
    const pickerMsg = ctx.callbackQuery.message;
    const src =
      pickerMsg && "reply_to_message" in pickerMsg
        ? pickerMsg.reply_to_message
        : undefined;
    const video = src?.video;
    const doc = src?.document?.mime_type?.startsWith("video/")
      ? src.document
      : undefined;
    const fileId = video?.file_id ?? doc?.file_id;
    if (!fileId) {
      await ctx.reply(
        "I couldn't find the original video for this picker — please send the video again."
      );
      return;
    }
    const fileSize = video?.file_size ?? doc?.file_size;
    if (fileSize !== undefined && fileSize > MAX_VIDEO_BYTES) {
      await ctx.reply(VIDEO_TOO_BIG_MSG);
      return;
    }
    const contentType = video?.mime_type ?? doc?.mime_type ?? "video/mp4";

    // Dismiss the picker, then status-message + edit (incart "Scraping..." pattern).
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    const status = await ctx.reply("Uploading video…");
    const done = (text: string) =>
      ctx.api.editMessageText(status.chat.id, status.message_id, text);

    try {
      const file = await ctx.api.getFile(fileId);
      if (!file.file_path) {
        await done("Telegram did not return a download path for that video. Please try again.");
        return;
      }
      const res = await fetch(
        `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`
      );
      if (!res.ok) {
        await done(`Error downloading the video from Telegram (HTTP ${res.status}).`);
        return;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      const upload = await uploadShoeVideo(shoeId, buffer, contentType);
      if (upload.error !== null) {
        await done(`Error uploading to storage: ${upload.error}`);
        return;
      }
      const result = await setVideoUrl(shoeId, upload.url, botMeta(ctx, entry.name));
      if (result.error) {
        await done(`Error: ${result.error}`);
        return;
      }
      await done(
        `Video attached to "${result.shoe!.title}".\n${upload.url}`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      await done(`Error attaching the video: ${msg}`);
    }
  });

  // ----- /clearvideo --------------------------------------------------------
  bot.command("clearvideo", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) return;
    const { shoes, error } = await getAllShoes();
    if (error) {
      await ctx.reply("Error fetching shoes.");
      return;
    }
    const withVideo = shoes.filter((s) => s.video_url != null);
    if (withVideo.length === 0) {
      await ctx.reply("No shoes have a video attached.");
      return;
    }
    await ctx.reply("Pick a shoe to remove its video:", {
      reply_markup: buildShoePickerKb(withVideo, "vidclr_pick"),
    });
  });

  bot.callbackQuery(/^vidclr_pick:(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const result = await setVideoUrl(shoeId, null, botMeta(ctx, entry.name));
    if (result.error) {
      await ctx.reply(`Error: ${result.error}`);
      return;
    }
    await ctx.reply(`Video cleared for "${result.shoe!.title}".`);
  });

  // ----- Tier-2 natural-language flow ------------------------------------
  // Maps the LLM intent's shoe field token back onto the Tier-1 helper call.

  /**
   * Parse free text into a Tier-2 intent and reply. Gated on opt-in env flags;
   * if the parse yields a command we ask for an explicit Yes/No confirmation —
   * nothing is mutated here. Never executes an LLM-derived change.
   */
  async function handleNlFreeText(ctx: Context, text: string): Promise<void> {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) return;

    // Opt-in only — Tier 1 keeps working when NL editing is disabled.
    if (process.env.SITE_EDIT_NL_ENABLED !== "true" || !process.env.ANTHROPIC_API_KEY) {
      await ctx.reply("Natural-language editing isn't configured.");
      return;
    }

    const { shoes, error } = await getAllShoes();
    if (error) {
      await ctx.reply("Error fetching shoes.");
      return;
    }
    const shoeRefs = shoes.map((s) => ({
      id: s.id,
      title: s.title,
      brand: s.brand,
      status: s.status,
    }));

    const intent = await parseOwnerIntent(text, shoeRefs);

    if ("error" in intent) {
      // not_configured is covered by the env gate above; treat the rest as a
      // soft failure the owner can retry or fall back to the menu commands.
      await ctx.reply(
        "Sorry, I couldn't turn that into a change. Try rephrasing, or use /edit, /remove, or /copy."
      );
      return;
    }
    if ("clarify" in intent) {
      await ctx.reply(intent.clarify);
      return;
    }

    // A concrete command → confirm before applying.
    const titleById = new Map(shoes.map((s) => [s.id, s.title] as const));
    const summary = summarizeNlCommand(intent, titleById);
    const kb = new InlineKeyboard()
      .text("Yes, apply", "nl_yes")
      .text("No, cancel", "nl_no");
    // The structured command rides in the message text as a base64 tag so the
    // Yes handler can reconstruct it statelessly (callback_data stays ≤64 bytes).
    await ctx.reply(`Apply this change: ${summary}?\n${encodeNlTag(intent)}`, {
      reply_markup: kb,
    });
  }

  /** Execute a confirmed Tier-2 command via the matching Tier-1 helper. */
  async function applyNlCommand(ctx: Context, cmd: NlCommand): Promise<void> {
    const meta = botMeta(ctx, entry.name);
    switch (cmd.command) {
      case "edit_field": {
        const result = await updateShoeField(cmd.args.shoe_id, cmd.args.field, cmd.args.value, meta);
        if (result.error) {
          await ctx.reply(`Error: ${result.error}`);
          return;
        }
        await ctx.reply(
          `Updated *${escMd(TOKEN_BY_FIELD[cmd.args.field])}* for "${escMd(result.shoe!.title)}"`,
          { parse_mode: "MarkdownV2" }
        );
        return;
      }
      case "set_sales": {
        const result = await setSalesStatus(cmd.args.shoe_id, cmd.args.status, meta);
        if (result.error) {
          await ctx.reply(`Error: ${result.error}`);
          return;
        }
        await ctx.reply(
          `Sales status set to *${escMd(cmd.args.status)}* for "${escMd(result.shoe!.title)}"`,
          { parse_mode: "MarkdownV2" }
        );
        return;
      }
      case "set_copy": {
        const result = await setCopy(
          cmd.args.key,
          cmd.args.lang,
          cmd.args.value,
          meta.actorLabel ?? "ops"
        );
        if (result.error) {
          await ctx.reply(`Error: ${result.error}`);
          return;
        }
        await ctx.reply(`Website copy "${cmd.args.key}" (${cmd.args.lang}) updated.`);
        return;
      }
      case "remove_shoe": {
        const result = await softRemoveShoe(cmd.args.shoe_id, meta);
        if (result.error) {
          await ctx.reply(`Error: ${result.error}`);
          return;
        }
        await ctx.reply("Done — the shoe is now hidden from the storefront.");
        return;
      }
      case "set_price_etb": {
        const result = await setPriceEtb(cmd.args.shoe_id, cmd.args.price_etb, meta);
        if (result.error) {
          await ctx.reply(`Error: ${result.error}`);
          return;
        }
        await ctx.reply(
          cmd.args.price_etb === null
            ? `Price cleared for "${result.shoe!.title}".`
            : `Price set for "${result.shoe!.title}" — ብር ${cmd.args.price_etb}`
        );
        return;
      }
      case "clear_video": {
        const result = await setVideoUrl(cmd.args.shoe_id, null, meta);
        if (result.error) {
          await ctx.reply(`Error: ${result.error}`);
          return;
        }
        await ctx.reply(`Video cleared for "${result.shoe!.title}".`);
        return;
      }
    }
  }

  // Yes → reconstruct the command from the confirmation text and apply it.
  bot.callbackQuery(/^nl_yes$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    const cmd = decodeNlTag(ctx.callbackQuery.message?.text);
    if (!cmd) {
      await ctx.reply("This confirmation expired — please send the request again.");
      return;
    }
    await applyNlCommand(ctx, cmd);
  });

  // No → cancel.
  bot.callbackQuery(/^nl_no$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery("Cancelled.");
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    await ctx.reply("Cancelled — no change made.");
  });

  // -------------------------------------------------------------------------
  // Stateless free-text capture — the ONLY ops-bot message:text handler.
  // Two paths, mutually exclusive on whether the message is a reply:
  //  • Reply carrying an [edit:...]/[copy:...]/[setprice:...] tag → Tier-1
  //    ForceReply capture.
  //  • Plain free text (no reply, not a slash command) → Tier-2 natural-language
  //    intent: parse with Claude, then ask for an explicit Yes/No confirmation
  //    before any change is applied (see the nl_yes/nl_no callbacks below).
  // Everything else is ignored so we never swallow unrelated messages.
  // -------------------------------------------------------------------------
  bot.on("message:text", async (ctx) => {
    const promptText = ctx.message.reply_to_message?.text;

    // ----- Tier-2: plain free text (not a reply, not a slash command) -------
    if (!promptText) {
      const text = ctx.message.text.trim();
      if (text.startsWith("/")) return; // Slash command → handled elsewhere.
      await handleNlFreeText(ctx, text);
      return;
    }

    const editMatch = promptText.match(/\[edit:([^:\]]+):([^\]]+)\]/);
    const copyMatch = promptText.match(/\[copy:([^:\]]+):(en|am)\]/);
    const setPriceMatch = promptText.match(/\[setprice:([^\]]+)\]/);
    if (!editMatch && !copyMatch && !setPriceMatch) return; // Not one of our prompts → ignore.

    // Re-verify admin before mutating.
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) return;

    const value = ctx.message.text.trim();
    const meta = botMeta(ctx, entry.name);

    if (setPriceMatch) {
      const shoeId = setPriceMatch[1];
      const lower = value.toLowerCase();
      if (lower === "none" || lower === "clear") {
        const result = await setPriceEtb(shoeId, null, meta);
        if (result.error) {
          await ctx.reply(`Error: ${result.error}`);
          return;
        }
        await ctx.reply(`Price cleared for "${result.shoe!.title}".`);
        return;
      }
      const digits = value.replace(/[,\s]/g, "");
      if (!/^\d+$/.test(digits) || Number(digits) <= 0) {
        await ctx.reply(
          'Please reply with a positive whole birr amount (e.g. 18500), or "none" to clear the price.'
        );
        return;
      }
      const result = await setPriceEtb(shoeId, Number(digits), meta);
      if (result.error) {
        await ctx.reply(`Error: ${result.error}`);
        return;
      }
      await ctx.reply(`Price set for "${result.shoe!.title}" — ብር ${Number(digits)}`);
      return;
    }

    if (editMatch) {
      const token = editMatch[1];
      const shoeId = editMatch[2];

      if (token === "sizes") {
        const result = await syncSizesFromText(shoeId, value);
        if (result.error) {
          await ctx.reply(`Error: ${result.error}`);
          return;
        }
        await ctx.reply("Sizes updated.");
        return;
      }

      const field = FIELD_BY_TOKEN[token];
      if (!field) {
        await ctx.reply("Unknown field — please start again with /edit.");
        return;
      }
      const result = await updateShoeField(shoeId, field, value, meta);
      if (result.error) {
        await ctx.reply(`Error: ${result.error}`);
        return;
      }
      await ctx.reply(
        `Updated *${escMd(TOKEN_BY_FIELD[field])}* for "${escMd(result.shoe!.title)}"`,
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    // copyMatch
    const key = copyMatch![1] as SiteCopyKey;
    const lang = copyMatch![2] as SiteCopyLang;
    const result = await setCopy(key, lang, value, meta.actorLabel ?? "ops");
    if (result.error) {
      await ctx.reply(`Error: ${result.error}`);
      return;
    }
    await ctx.reply(`Website copy "${key}" (${lang}) updated.`);
  });
}
