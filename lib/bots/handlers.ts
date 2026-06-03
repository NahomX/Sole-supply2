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
 */

import { Bot, Context, InlineKeyboard } from "grammy";
import type { BotEntry } from "./registry";
import { checkAllowlist } from "./auth";
import {
  getPublicShoes,
  getShoesByLogistics,
  getAllShoes,
  createShoeFromUrl,
  setLogisticsStatus,
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
  if (s.logistics_status) parts.push(`Logistics: ${escMd(s.logistics_status)}`);
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
    await ctx.reply(`Access denied: ${result.reason}`);
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
      "Welcome to Sole Supply! Browse our sneaker collection:",
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
// ---------------------------------------------------------------------------

export function registerIncartBot(bot: Bot, entry: BotEntry) {
  bot.command("start", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "shipper"))) return;
    await ctx.reply(
      "In-cart bot. Paste a product URL to add a shoe to the in-cart queue."
    );
  });

  bot.command("help", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "shipper"))) return;
    await ctx.reply(
      "Paste any retailer product URL and I will scrape it and create a shoe with logistics_status = in_cart."
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
    await ctx.api.editMessageText(
      ctx.chat.id,
      msg.message_id,
      `Shoe added to in-cart queue:\n\n${formatShoe(shoe)}`
    );
  });
}

// ---------------------------------------------------------------------------
// Generic work-bot factory — covers purchaser, arrived, delivery
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
    listLabel: "Shoes in cart (ready to purchase)",
    actionLabel: "Mark purchased",
  },
  arrived: {
    fromStatus: "purchased",
    toStatus: "arrived",
    listLabel: "Purchased shoes (awaiting arrival)",
    actionLabel: "Mark arrived",
  },
  delivery: {
    fromStatus: "arrived",
    toStatus: "delivered",
    listLabel: "Arrived shoes (ready for delivery)",
    actionLabel: "Mark delivered",
  },
};

export function registerWorkBot(bot: Bot, entry: BotEntry) {
  const config = WORK_BOT_CONFIGS[entry.name];
  if (!config) throw new Error(`No work-bot config for: ${entry.name}`);

  async function listAndShow(ctx: Context) {
    if (!(await guardAllowlist(ctx, entry.name, "shipper"))) return;
    const { shoes, error } = await getShoesByLogistics(config.fromStatus);
    if (error) {
      await ctx.reply("Error fetching shoes.");
      return;
    }
    if (shoes.length === 0) {
      await ctx.reply(`No shoes with status "${config.fromStatus}" right now.`);
      return;
    }
    const kb = new InlineKeyboard();
    shoes.forEach((s, i) => {
      const label = `${s.brand ? `[${s.brand}] ` : ""}${s.title.slice(0, 40)}`;
      kb.text(label, `advance:${s.id}`);
      if (i % 1 === 0) kb.row(); // one button per row for readability
    });
    await ctx.reply(
      `${config.listLabel} (${shoes.length})\nTap a shoe to ${config.actionLabel.toLowerCase()}:`,
      { reply_markup: kb }
    );
  }

  bot.command("start", listAndShow);
  bot.command("list", listAndShow);
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
    const result = await setLogisticsStatus(shoeId, config.toStatus, botMeta(ctx, entry.name));
    if (result.error) {
      await ctx.reply(`Error: ${result.error}`);
      return;
    }
    await ctx.reply(
      `Done! "${result.shoe!.title}" is now *${escMd(config.toStatus)}*`,
      { parse_mode: "MarkdownV2" }
    );
  });
}

// ---------------------------------------------------------------------------
// Owner ops bot — full control
// ---------------------------------------------------------------------------

export function registerOpsBot(bot: Bot, entry: BotEntry) {
  bot.command("start", async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) return;
    await ctx.reply(
      "Sole Supply ops bot.\n\nCommands:\n" +
        "/list — full pipeline overview\n" +
        "/whoami — your Telegram ID\n" +
        "/sales — manage sales status\n" +
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
        "/logistics — change logistics status"
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
      const log = s.logistics_status ?? "no logistics";
      return `• [${s.status}/${log}] ${s.title.slice(0, 60)}`;
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

  // /logistics — list shoes with inline keyboard to set logistics status
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
      const log = s.logistics_status ?? "none";
      const label = `${s.title.slice(0, 35)} [${log}]`;
      kb.text(label, `ops_log_pick:${s.id}`).row();
    });
    await ctx.reply("Pick a shoe to change its logistics status:", {
      reply_markup: kb,
    });
  });

  bot.callbackQuery(/^ops_log_pick:(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const kb = new InlineKeyboard();
    // Include a "clear" option and all logistics states
    kb.text("clear (null)", `ops_log_set:${shoeId}:__null__`).row();
    LOGISTICS.forEach((s) => kb.text(s, `ops_log_set:${shoeId}:${s}`).row());
    await ctx.reply("Choose new logistics status:", { reply_markup: kb });
  });

  bot.callbackQuery(/^ops_log_set:([^:]+):(.+)$/, async (ctx) => {
    if (!(await guardAllowlist(ctx, entry.name, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const raw = ctx.match[2];
    const newStatus = raw === "__null__" ? null : (raw as LogisticsStatus);
    const result = await setLogisticsStatus(shoeId, newStatus, botMeta(ctx, entry.name));
    if (result.error) {
      await ctx.reply(`Error: ${result.error}`);
      return;
    }
    const label = newStatus ?? "cleared";
    await ctx.reply(
      `Logistics status set to *${escMd(label)}* for "${escMd(result.shoe!.title)}"`,
      { parse_mode: "MarkdownV2" }
    );
  });
}
