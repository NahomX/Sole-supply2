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
 * Work bots verify the allowlist via checkAllowlist before every action.
 *
 * Phase 1 (INTERIM): work bots use advanceAllSizes(shoeId, toStatus) so they
 * keep working after shoes.logistics_status is dropped. This is an interim
 * measure — Phase 2 will replace with per-size drill-down multi-select.
 *
 * Ops bot /logistics: kept functional at shoe level (advances all sizes) for
 * Phase 1. Full per-size manual override via the /admin web UI.
 */

import { Bot, Context, InlineKeyboard } from "grammy";
import type { BotEntry } from "./registry";
import { checkAllowlist } from "./auth";
import {
  getPublicShoes,
  getShoesByLogistics,
  getAllShoes,
  createShoeFromUrl,
  advanceAllSizes,
  setSalesStatus,
  STATUSES,
  LOGISTICS,
} from "@/lib/shoes";
import type { FeedMeta } from "@/lib/shoes";
import type { Shoe, LogisticsStatus, ShoeStatus } from "@/lib/supabase";

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
  if (s.sizes) parts.push(`Sizes: ${escMd(s.sizes)}`);
  if (s.status) parts.push(`Sales: ${escMd(s.status)}`);
  // Phase 1: no per-shoe logistics_status; show per-size summary if available.
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
  requiredRole: "shipper" | "admin"
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
    ctx.reply("Use /start to browse.", { reply_markup: new InlineKeyboard().text("Available now", "list:available") })
  );

  bot.command("upcoming", (ctx) =>
    ctx.reply("Use /start to browse.", { reply_markup: new InlineKeyboard().text("Coming soon", "list:upcoming") })
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
// In-cart bot — paste a URL to create a shoe with logistics_status = in_cart
// Phase 1: shoe is created; sizes are added later via the admin per-size editor.
// ---------------------------------------------------------------------------

export function registerIncartBot(bot: Bot, entry: BotEntry) {
  bot.command("start", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "shipper"))) return;
    await ctx.reply(
      "In-cart bot. Paste a product URL to add a shoe to the in-cart queue.\n" +
      "(Phase 1: add sizes in /admin after creating the shoe.)"
    );
  });

  bot.command("help", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "shipper"))) return;
    await ctx.reply(
      "Paste any retailer product URL and I will scrape it and create a shoe. " +
      "Use /admin to add sizes and set their logistics status."
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
    // Pass logistics_status for backward compat — createShoeFromUrl maps it
    // to initial_logistics_status internally.
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
    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      `Shoe added to in-cart queue:\n\n${formatShoe(shoe)}`
    );
  });
}

// ---------------------------------------------------------------------------
// Generic work-bot factory — covers purchaser, arrived, delivery
//
// INTERIM (Phase 1): "tap a shoe → advance ALL its sizes" keeps the bots
// working after shoes.logistics_status is dropped. Phase 2 replaces this with
// per-size drill-down multi-select.
// ---------------------------------------------------------------------------

type WorkBotConfig = {
  fromStatus: LogisticsStatus;
  toStatus: LogisticsStatus;
  listLabel: string;
  actionLabel: string;
};

const WORK_BOT_CONFIGS: Record<string, WorkBotConfig> = {
  purchaser: {
    fromStatus: "in_cart",
    toStatus: "purchased",
    listLabel: "Shoes with in-cart sizes (ready to purchase)",
    actionLabel: "Mark all sizes purchased",
  },
  arrived: {
    fromStatus: "purchased",
    toStatus: "arrived",
    listLabel: "Purchased shoes (awaiting arrival)",
    actionLabel: "Mark all sizes arrived",
  },
  delivery: {
    fromStatus: "arrived",
    toStatus: "delivered",
    listLabel: "Arrived shoes (ready for delivery)",
    actionLabel: "Mark all sizes delivered",
  },
};

export function registerWorkBot(bot: Bot, entry: BotEntry) {
  const config = WORK_BOT_CONFIGS[entry.name];
  if (!config) throw new Error(`No work-bot config for: ${entry.name}`);

  async function listAndShow(ctx: Context) {
    if (!(await guardAllowlist(ctx, entry.name, "shipper"))) return;
    // getShoesByLogistics now returns shoes with ≥1 size at fromStatus.
    const { shoes, error } = await getShoesByLogistics(config.fromStatus);
    if (error) {
      await ctx.reply("Error fetching shoes.");
      return;
    }
    if (shoes.length === 0) {
      await ctx.reply(`No shoes with any size at "${config.fromStatus}" right now.`);
      return;
    }
    const kb = new InlineKeyboard();
    shoes.forEach((s, i) => {
      const label = `${s.brand ? `[${s.brand}] ` : ""}${s.title.slice(0, 40)}`;
      kb.text(label, `advance:${s.id}`);
      if (i % 1 === 0) kb.row(); // one button per row for readability
    });
    await ctx.reply(
      `${config.listLabel} (${shoes.length})\nTap a shoe to ${config.actionLabel.toLowerCase()}:\n\n(Phase 1: all eligible sizes advance together)`,
      { reply_markup: kb }
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
    if (!(await guardAllowlist(ctx, entry.name, "shipper"))) return;
    await ctx.reply(
      `${entry.description}\n\nUse /list to see ${config.listLabel.toLowerCase()}.\nTap a shoe button to ${config.actionLabel.toLowerCase()}.`
    );
  });

  bot.callbackQuery(/^advance:(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "shipper"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    // INTERIM: advance ALL sizes at fromStatus → toStatus.
    // Phase 2 will replace with per-size drill-down selection.
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
      `Done! ${result.count} size${result.count === 1 ? "" : "s"} advanced to *${escMd(config.toStatus)}*`,
      { parse_mode: "MarkdownV2" }
    );
  });
}

// ---------------------------------------------------------------------------
// Owner ops bot — full control
//
// Phase 1 (INTERIM): /logistics shows shoes → tap → advances ALL sizes of that
// shoe to a chosen status (same "advance all" interim behavior as work bots).
// Full per-size manual override is available in the /admin web UI.
// ---------------------------------------------------------------------------

export function registerOpsBot(bot: Bot, entry: BotEntry) {
  bot.command("start", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) return;
    await ctx.reply(
      "Berebaso ops bot.\n\nCommands:\n" +
        "/list — full pipeline overview\n" +
        "/whoami — your Telegram ID\n" +
        "/sales — manage sales status\n" +
        "/logistics — advance all sizes of a shoe (interim; use /admin for per-size)\n" +
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
        "/logistics — advance all sizes of a shoe (interim — use /admin for per-size control)"
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
      // Show per-size summary: "9:purchased, 10:arrived" or "no sizes"
      const szs = s.shoe_sizes ?? [];
      const logSummary = szs.length > 0
        ? szs.map((sz) => `${sz.us_size}:${sz.logistics_status ?? "—"}`).join(", ")
        : "no sizes";
      return `• [${s.status}] ${s.title.slice(0, 50)} — ${logSummary}`;
    });
    await ctx.reply(`Pipeline (${shoes.length} shoes):\n\n` + lines.join("\n"));
  });

  // /sales — list shoes with inline keyboard to set sales status
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
    await ctx.reply("Pick a shoe to change its sales status:", {
      reply_markup: kb,
    });
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
    await ctx.reply(`Sales status set to *${escMd(newStatus)}* for "${escMd(result.shoe!.title)}"`, {
      parse_mode: "MarkdownV2",
    });
  });

  // /logistics — INTERIM: pick a shoe → pick a target status → advance all sizes.
  // Phase 2 will add per-size drill-down here.
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
      const summary = szs.length > 0
        ? szs.map((sz) => `${sz.us_size}:${sz.logistics_status ?? "—"}`).join(", ")
        : "no sizes";
      const label = `${s.title.slice(0, 30)} [${summary.slice(0, 20)}]`;
      kb.text(label, `ops_log_pick:${s.id}`).row();
    });
    await ctx.reply(
      "Pick a shoe to advance all its sizes (Phase 1 interim — use /admin for per-size):",
      { reply_markup: kb }
    );
  });

  bot.callbackQuery(/^ops_log_pick:(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const kb = new InlineKeyboard();
    // Offer all target statuses (advance-all semantics).
    LOGISTICS.forEach((s) => kb.text(s, `ops_log_set:${shoeId}:${s}`).row());
    await ctx.reply("Advance all eligible sizes to:", { reply_markup: kb });
  });

  bot.callbackQuery(/^ops_log_set:([^:]+):(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const toStatus = ctx.match[2] as LogisticsStatus;
    // INTERIM: advance all eligible sizes (predecessor → toStatus).
    const result = await advanceAllSizes(shoeId, toStatus, botMeta(ctx, entry.name));
    if (result.error) {
      await ctx.reply(`Error: ${result.error}`);
      return;
    }
    if (result.count === 0) {
      await ctx.reply(
        `No eligible sizes to advance to "${toStatus}". Use /admin to set individual sizes.`
      );
      return;
    }
    await ctx.reply(
      `${result.count} size${result.count === 1 ? "" : "s"} advanced to *${escMd(toStatus)}*`,
      { parse_mode: "MarkdownV2" }
    );
  });
}
