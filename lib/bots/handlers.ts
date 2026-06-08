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
 * UUID shoeId is 36 chars; longest usSize is "10.5" (4 chars); longest status
 * is "delivered" (9 chars). Longest callback: ops_log_st:36:4:9 = 56 bytes.
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
  STATUSES,
  LOGISTICS,
} from "@/lib/shoes";
import type { FeedMeta } from "@/lib/shoes";
import { SIZE_GRID } from "@/lib/sizes";
import type { Shoe, LogisticsStatus, ShoeStatus, ShoeSize } from "@/lib/supabase";

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
      const price = s.price_usd != null ? ` — $${s.price_usd}` : "";
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
    await ctx.reply(
      `${entry.description}\n\n` +
        `Use /list to see ${config.listLabel.toLowerCase()}.\n` +
        `Tap a shoe → tap sizes to select → "Advance selected" (only those) or "Advance all".`
    );
  });

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
        "/help — this message"
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
        "/logistics — per-size drill-down: pick shoe → pick size → pick status (or clear)"
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
}
