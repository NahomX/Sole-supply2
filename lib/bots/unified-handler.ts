/**
 * lib/bots/unified-handler.ts — grammY handler for the unified admin group bot.
 *
 * Consolidates incart + purchaser + arrived + delivery + ops into ONE bot that
 * runs in a Telegram GROUP CHAT. The customer bot remains separate (public).
 *
 * Key differences from the per-bot handlers in handlers.ts:
 *  1. Group-chat restriction via ADMIN_GROUP_CHAT_ID (fail-closed).
 *  2. Per-ACTION role enforcement (not per-bot). Each command/callback checks
 *     the required role for that specific action.
 *  3. Quantity support in the add-shoe flow (fixes the incart gap from PR #37).
 *  4. Photo-match flow selection (user picks which transition before matching).
 *
 * ---------------------------------------------------------------------------
 * Callback data scheme (all values <= 64 bytes per Telegram limits)
 * ---------------------------------------------------------------------------
 * Pipeline (purchase/arrive/deliver):
 *   u_pk:{f}:{shoeId}              — pick shoe (f = p|a|d)
 *   u_sz:{f}:{shoeId}:{usSize}     — toggle size
 *   u_go:{f}:{shoeId}              — advance selected
 *   u_al:{f}:{shoeId}              — advance all
 *
 * Add shoe (/add):
 *   u_as:{shoeId}:{usSize}         — toggle size
 *   u_aq:{shoeId}:{qty}            — set quantity (radio)
 *   u_ad:{shoeId}                  — done (add selected with qty)
 *   u_ak:{shoeId}                  — skip
 *
 * Photo match:
 *   u_pf:{f}                       — select flow (p|a|d); message is reply to photo
 *   u_pm:{f}:{shoeId}              — confirm match, advance
 *   u_pn                           — reject all matches
 *
 * PO:
 *   u_pa:{poId}                    — approve
 *   u_pd:{poId}                    — decline
 *
 * Sales:
 *   u_sp:{shoeId}                  — pick shoe
 *   u_ss:{shoeId}:{status}         — set status
 *
 * Logistics:
 *   u_lp:{shoeId}                  — pick shoe
 *   u_ls:{shoeId}:{usSize}         — pick size
 *   u_lt:{shoeId}:{usSize}:{st}    — set status (st can be "null")
 *
 * Edit:
 *   u_ep:{shoeId}                  — pick shoe
 *   u_ef:{shoeId}:{field}          — field chosen
 *   u_es:{shoeId}:{status}         — set sales via edit
 *
 * Remove:
 *   u_rp:{shoeId}                  — pick shoe
 *   u_ry:{shoeId}                  — confirm
 *   u_rn                           — cancel
 *
 * Copy:
 *   u_ck:{key}                     — key selected
 *   u_cl:{key}:{lang}              — language selected
 *
 * Setprice:
 *   u_pp:{shoeId}                  — pick shoe
 *
 * Video:
 *   u_vp:{shoeId}                  — pick shoe for video
 *
 * Clear video:
 *   u_vc:{shoeId}                  — pick shoe
 *
 * NL:
 *   u_ny                           — confirm
 *   u_nn                           — cancel
 *
 * Longest: u_lt:{36}:{4}:{9} = 56 bytes. All within 64-byte limit.
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
// Types
// ---------------------------------------------------------------------------

type ActionRole = "shipper" | "purchaser" | "admin";

type FlowConfig = {
  fromStatus: LogisticsStatus;
  toStatus: LogisticsStatus;
  roleRequired: ActionRole;
  listLabel: string;
};

// ---------------------------------------------------------------------------
// Flow configs — maps flow code (p/a/d) to transition + required role
// ---------------------------------------------------------------------------

const FLOW_CONFIGS: Record<string, FlowConfig> = {
  p: {
    fromStatus: "in_cart",
    toStatus: "purchased",
    roleRequired: "purchaser",
    listLabel: "Shoes with in-cart sizes (ready to purchase)",
  },
  a: {
    fromStatus: "purchased",
    toStatus: "arrived",
    roleRequired: "shipper",
    listLabel: "Purchased shoes (awaiting arrival)",
  },
  d: {
    fromStatus: "arrived",
    toStatus: "delivered",
    roleRequired: "shipper",
    listLabel: "Arrived shoes (ready for delivery)",
  },
};

// ---------------------------------------------------------------------------
// Helpers — Markdown escaping, feed metadata, formatting
// ---------------------------------------------------------------------------

/** Escape special characters for Telegram MarkdownV2. */
function escMd(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

function botMeta(ctx: Context, botName: string): FeedMeta {
  const username = ctx.from?.username;
  const firstName = ctx.from?.first_name;
  const actorLabel = username
    ? `@${username}`
    : (firstName ?? `tg:${ctx.from?.id}`);
  return { actorLabel, source: botName };
}

// ---------------------------------------------------------------------------
// Group chat restriction
// ---------------------------------------------------------------------------

function isAuthorizedChat(ctx: Context): boolean {
  const groupId = process.env.ADMIN_GROUP_CHAT_ID;
  if (!groupId) return false; // fail-closed: no env var = deny
  // Allow the authorized group chat
  if (String(ctx.chat?.id) === groupId) return true;
  // Allow private DMs with the bot (for /whoami)
  if (ctx.chat?.type === "private") return true;
  return false;
}

// ---------------------------------------------------------------------------
// Per-action role enforcement
// ---------------------------------------------------------------------------

async function guardAction(
  ctx: Context,
  requiredRole: ActionRole
): Promise<boolean> {
  if (!isAuthorizedChat(ctx)) {
    await ctx.reply("This bot only operates in the authorized admin group.");
    return false;
  }
  const telegramId = ctx.from?.id;
  if (!telegramId) {
    await ctx.reply("Could not identify your Telegram account.");
    return false;
  }
  const result = await checkAllowlist(telegramId, "unified", requiredRole);
  if (!result.allowed) {
    await ctx.reply(
      `Access denied: ${result.reason}\n\nYour Telegram ID: ${telegramId}`
    );
    return false;
  }
  return true;
}

/** Lighter guard for commands that only need chat restriction, no role. */
function guardChat(ctx: Context): boolean {
  return isAuthorizedChat(ctx);
}

// ---------------------------------------------------------------------------
// Stateless keyboard helpers
// ---------------------------------------------------------------------------

const CHECK = "✓ "; // ✓
const QTY_CHECK = "* ";
const QTY_OPTIONS = [1, 2, 3, 5, 10];

/**
 * Toggle one button's CHECK prefix in an existing keyboard.
 * Returns a new InlineKeyboard with the toggled state.
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
    }
    if (r < existingRows.length - 1) kb.row();
  }
  return kb;
}

/**
 * Radio-select one button in a group — set QTY_CHECK on the tapped button,
 * remove QTY_CHECK from all other buttons whose callback starts with the
 * same prefix (u_aq:).
 */
function radioSelectInKb(
  existingRows: InlineKeyboardButton[][],
  selectCallback: string,
  cbPrefix: string
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let r = 0; r < existingRows.length; r++) {
    const row = existingRows[r];
    for (let c = 0; c < row.length; c++) {
      const btn = row[c];
      if (!("callback_data" in btn)) {
        kb.text(btn.text, "noop");
        continue;
      }
      if (
        "callback_data" in btn &&
        btn.callback_data?.startsWith(cbPrefix)
      ) {
        // This is a qty button — set or clear the prefix
        const baseText = btn.text.startsWith(QTY_CHECK)
          ? btn.text.slice(QTY_CHECK.length)
          : btn.text;
        if (btn.callback_data === selectCallback) {
          kb.text(QTY_CHECK + baseText, btn.callback_data);
        } else {
          kb.text(baseText, btn.callback_data);
        }
      } else {
        kb.text(btn.text, btn.callback_data ?? "noop");
      }
    }
    if (r < existingRows.length - 1) kb.row();
  }
  return kb;
}

/**
 * Extract all CHECK-selected US sizes from an inline keyboard.
 */
function getSelectedSizes(rows: InlineKeyboardButton[][]): string[] {
  const selected: string[] = [];
  for (const row of rows) {
    for (const btn of row) {
      if (!("callback_data" in btn)) continue;
      if (!btn.text.includes("US ")) continue;
      if (btn.text.startsWith(CHECK)) {
        const size = btn.text.slice(CHECK.length).replace(/^US /, "");
        selected.push(size);
      }
    }
  }
  return selected;
}

/**
 * Extract the selected quantity from an inline keyboard (QTY_CHECK-prefixed
 * button in the qty row). Returns 1 if none selected.
 */
function getSelectedQty(rows: InlineKeyboardButton[][]): number {
  for (const row of rows) {
    for (const btn of row) {
      if (!("callback_data" in btn)) continue;
      if (btn.text.startsWith(QTY_CHECK)) {
        const n = parseInt(btn.text.slice(QTY_CHECK.length), 10);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Keyboard builders
// ---------------------------------------------------------------------------

/** Shoe-picker keyboard — one button per shoe, capped at 20. */
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

/** Size-toggle keyboard for pipeline flows (purchase/arrive/deliver). */
function buildSizeToggleKb(
  shoeId: string,
  eligibleSizes: ShoeSize[],
  flowCode: string
): InlineKeyboard {
  const kb = new InlineKeyboard();
  eligibleSizes.forEach((sz, i) => {
    kb.text(`US ${sz.us_size}`, `u_sz:${flowCode}:${shoeId}:${sz.us_size}`);
    if ((i + 1) % 4 === 0) kb.row();
  });
  kb.row();
  kb.text("Advance selected", `u_go:${flowCode}:${shoeId}`).text(
    "Advance all",
    `u_al:${flowCode}:${shoeId}`
  );
  return kb;
}

/**
 * Size-selection keyboard for the add-shoe flow.
 * Shows the full SIZE_GRID + a qty selector row + action buttons.
 * Includes quantity (default 1 selected).
 */
function buildAddSizeKb(shoeId: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  SIZE_GRID.forEach((e, i) => {
    kb.text(`US ${e.us}`, `u_as:${shoeId}:${e.us}`);
    if ((i + 1) % 4 === 0) kb.row();
  });
  if (SIZE_GRID.length % 4 !== 0) kb.row();
  // Qty row — default 1 selected
  QTY_OPTIONS.forEach((q, i) => {
    const label = i === 0 ? `${QTY_CHECK}${q}` : `${q}`;
    kb.text(label, `u_aq:${shoeId}:${q}`);
  });
  kb.row();
  kb.text("Add selected sizes", `u_ad:${shoeId}`).text(
    "Skip (add later)",
    `u_ak:${shoeId}`
  );
  return kb;
}

// ---------------------------------------------------------------------------
// Tier-2 NL confirmation helpers (copied from handlers.ts — not exported)
// ---------------------------------------------------------------------------

type NlCommand = Extract<OwnerIntent, { command: string }>;

function encodeNlTag(cmd: NlCommand): string {
  const b64 = Buffer.from(JSON.stringify(cmd), "utf8").toString("base64");
  return `[nl:${b64}]`;
}

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

function summarizeNlCommand(
  cmd: NlCommand,
  shoeTitleById: Map<string, string>
): string {
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

// ---------------------------------------------------------------------------
// Field-token maps for /edit (mirrors handlers.ts ops bot)
// ---------------------------------------------------------------------------

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
const COPY_KEYS: SiteCopyKey[] = [
  "hero_tagline",
  "section_available",
  "section_on_the_way",
  "section_coming_soon",
  "section_previously",
  "footer",
];

// ===================================================================
// registerUnifiedBot — the single exported function
// ===================================================================

export function registerUnifiedBot(bot: Bot, entry: BotEntry): void {
  // -----------------------------------------------------------------
  // /start, /help — welcome + command list
  // -----------------------------------------------------------------
  bot.command("start", async (ctx) => {
    if (!guardChat(ctx)) {
      await ctx.reply("This bot only operates in the authorized admin group.");
      return;
    }
    await ctx.reply(
      "Berebaso unified ops bot.\n\nCommands:\n" +
        "/add <URL> — add a shoe (paste a retailer URL)\n" +
        "/purchase — advance in-cart sizes to purchased\n" +
        "/arrive — advance purchased sizes to arrived\n" +
        "/deliver — advance arrived sizes to delivered\n" +
        "/pending — draft Purchase Orders (approve/decline)\n" +
        "/sales — manage sales status\n" +
        "/logistics — per-size logistics corrections\n" +
        "/edit — edit shoe fields\n" +
        "/setprice — set the customer-facing birr price\n" +
        "/remove — hide a shoe from the storefront\n" +
        "/clearvideo — remove a shoe's video\n" +
        "/copy — edit website copy\n" +
        "/list — full pipeline overview\n" +
        "/whoami — your Telegram ID\n" +
        "/help — this message\n\n" +
        "Send a video to attach it to a shoe (admin).\n" +
        "Send a photo for AI shoe matching.\n\n" +
        "Tip: when enabled, admins can type plain instructions " +
        '(e.g. "mark the Jordan 1s as sold") and confirm the change.'
    );
  });

  bot.command("help", async (ctx) => {
    if (!guardChat(ctx)) {
      await ctx.reply("This bot only operates in the authorized admin group.");
      return;
    }
    await ctx.reply(
      "Berebaso unified ops bot — commands:\n\n" +
        "Pipeline:\n" +
        "  /add <URL> — add shoe (shipper+)\n" +
        "  /purchase — in_cart → purchased (purchaser+)\n" +
        "  /arrive — purchased → arrived (shipper+)\n" +
        "  /deliver — arrived → delivered (shipper+)\n" +
        "  /pending — draft PO approval (purchaser+)\n\n" +
        "Admin:\n" +
        "  /sales — sales status\n" +
        "  /logistics — per-size logistics drill-down\n" +
        "  /edit — edit shoe title/brand/price/notes/sizes/sales\n" +
        "  /setprice — birr price\n" +
        "  /remove — soft-remove shoe\n" +
        "  /clearvideo — clear shoe video\n" +
        "  /copy — website copy\n" +
        "  /list — full pipeline\n\n" +
        "Photo: send a photo → pick flow → AI match\n" +
        "Video: send a video → pick shoe → attach (admin)\n" +
        "Text: plain instruction → confirm (admin, NL editing)"
    );
  });

  bot.command("whoami", async (ctx) => {
    // /whoami works in private DM too — useful for getting your ID
    await ctx.reply(
      `Your Telegram ID: ${ctx.from?.id ?? "unknown"}\nUsername: @${ctx.from?.username ?? "none"}`
    );
  });

  // -----------------------------------------------------------------
  // /add <URL> — create shoe + size picker with quantity (shipper+)
  // -----------------------------------------------------------------
  bot.command("add", async (ctx) => {
    if (!(await guardAction(ctx, "shipper"))) return;
    const text = ctx.match?.trim() ?? "";
    if (!/^https?:\/\//i.test(text)) {
      await ctx.reply(
        "Usage: /add <URL>\n\nPaste a full retailer product URL after the command."
      );
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
        ctx.chat!.id,
        msg.message_id,
        `Error: ${result.error ?? "unknown error"}`
      );
      return;
    }
    const shoe = result.shoe;
    const brandLine = shoe.brand ? `\nBrand: ${escMd(shoe.brand)}` : "";
    const priceLine =
      shoe.price_usd != null ? `\nPrice: \\$${shoe.price_usd}` : "";
    await ctx.api.editMessageText(
      ctx.chat!.id,
      msg.message_id,
      `Shoe added:\n\n*${escMd(shoe.title)}*${brandLine}${priceLine}\n\nTap sizes to select them \\(set to in\\_cart\\)\\. Set quantity per size, then tap "Add selected sizes"\\.`,
      {
        parse_mode: "MarkdownV2",
        reply_markup: buildAddSizeKb(shoe.id),
      }
    );
  });

  // Toggle a size in the add flow
  bot.callbackQuery(/^u_as:([^:]+):(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "shipper"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const existingRows =
      ctx.callbackQuery.message?.reply_markup?.inline_keyboard ?? [];
    const newKb = toggleButtonInKb(existingRows, ctx.callbackQuery.data);
    await ctx.editMessageReplyMarkup({ reply_markup: newKb });
  });

  // Set quantity (radio select)
  bot.callbackQuery(/^u_aq:([^:]+):(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "shipper"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const existingRows =
      ctx.callbackQuery.message?.reply_markup?.inline_keyboard ?? [];
    const newKb = radioSelectInKb(
      existingRows,
      ctx.callbackQuery.data,
      `u_aq:${shoeId}:`
    );
    await ctx.editMessageReplyMarkup({ reply_markup: newKb });
  });

  // Add selected sizes with quantity
  bot.callbackQuery(/^u_ad:(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "shipper"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const existingRows =
      ctx.callbackQuery.message?.reply_markup?.inline_keyboard ?? [];
    const selectedSizes = getSelectedSizes(existingRows);
    const qty = getSelectedQty(existingRows);
    if (selectedSizes.length === 0) {
      await ctx.reply(
        'No sizes selected. Tap sizes to select them, or use "Skip" to add later via /admin.'
      );
      return;
    }
    const errors: string[] = [];
    for (const sz of selectedSizes) {
      const addResult = await addSize(shoeId, sz, qty);
      if (addResult.error) {
        errors.push(`US ${sz}: ${addResult.error}`);
        continue;
      }
      const statusResult = await setSizeStatus(
        shoeId,
        sz,
        "in_cart",
        botMeta(ctx, entry.name)
      );
      if (statusResult.error)
        errors.push(`US ${sz}: ${statusResult.error}`);
    }
    const sizeList = selectedSizes.map((s) => `US ${s}`).join(", ");
    const qtyNote = qty > 1 ? ` (${qty} pair${qty === 1 ? "" : "s"} each)` : "";
    if (errors.length > 0) {
      await ctx.reply(
        `Added ${selectedSizes.length - errors.length} size(s) to in-cart${qtyNote}. Errors:\n${errors.join("\n")}`
      );
    } else {
      await ctx.reply(`Done! ${sizeList} added and set to in_cart${qtyNote}.`);
    }
    await ctx.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });
  });

  // Skip size selection
  bot.callbackQuery(/^u_ak:(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "shipper"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery("Sizes skipped — add them in /admin.");
    await ctx.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });
  });

  // -----------------------------------------------------------------
  // /purchase, /arrive, /deliver — pipeline flow commands
  // -----------------------------------------------------------------

  function registerFlowCommand(commandName: string, flowCode: string) {
    const config = FLOW_CONFIGS[flowCode];

    bot.command(commandName, async (ctx) => {
      if (!(await guardAction(ctx, config.roleRequired))) return;
      const { shoes, error } = await getShoesByLogistics(config.fromStatus);
      if (error) {
        await ctx.reply("Error fetching shoes.");
        return;
      }
      if (shoes.length === 0) {
        await ctx.reply(
          `No shoes with any size at "${config.fromStatus}" right now.`
        );
        return;
      }
      const kb = new InlineKeyboard();
      shoes.slice(0, 20).forEach((s) => {
        const brand = s.brand ? `[${s.brand}] ` : "";
        const label = `${brand}${s.title}`.slice(0, 40);
        kb.text(label, `u_pk:${flowCode}:${s.id}`).row();
      });
      await ctx.reply(
        `${config.listLabel} (${shoes.length})\nTap a shoe to select sizes:`,
        { reply_markup: kb }
      );
    });
  }

  registerFlowCommand("purchase", "p");
  registerFlowCommand("arrive", "a");
  registerFlowCommand("deliver", "d");

  // Pick shoe -> show eligible sizes as toggle keyboard
  bot.callbackQuery(/^u_pk:([pad]):(.+)$/, async (ctx) => {
    const flowCode = ctx.match[1];
    const config = FLOW_CONFIGS[flowCode];
    if (!(await guardAction(ctx, config.roleRequired))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[2];
    const { sizes, error } = await getShoeSizes(shoeId);
    if (error) {
      await ctx.reply(`Error fetching sizes: ${error}`);
      return;
    }
    const eligible = sizes.filter(
      (sz) => sz.logistics_status === config.fromStatus
    );
    if (eligible.length === 0) {
      await ctx.reply(
        `No sizes at "${config.fromStatus}" for that shoe. Check /admin for current status.`
      );
      return;
    }
    await ctx.reply("Tap sizes to select, then choose an action:", {
      reply_markup: buildSizeToggleKb(shoeId, eligible, flowCode),
    });
  });

  // Toggle a size in a pipeline flow
  bot.callbackQuery(/^u_sz:([pad]):([^:]+):(.+)$/, async (ctx) => {
    const flowCode = ctx.match[1];
    const config = FLOW_CONFIGS[flowCode];
    if (!(await guardAction(ctx, config.roleRequired))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const existingRows =
      ctx.callbackQuery.message?.reply_markup?.inline_keyboard ?? [];
    const newKb = toggleButtonInKb(existingRows, ctx.callbackQuery.data);
    await ctx.editMessageReplyMarkup({ reply_markup: newKb });
  });

  // Advance selected sizes
  bot.callbackQuery(/^u_go:([pad]):(.+)$/, async (ctx) => {
    const flowCode = ctx.match[1];
    const config = FLOW_CONFIGS[flowCode];
    if (!(await guardAction(ctx, config.roleRequired))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[2];
    const existingRows =
      ctx.callbackQuery.message?.reply_markup?.inline_keyboard ?? [];
    const selectedSizes = getSelectedSizes(existingRows);
    if (selectedSizes.length === 0) {
      await ctx.reply(
        'No sizes selected. Tap sizes to mark them, or use "Advance all".'
      );
      return;
    }
    const errors: string[] = [];
    for (const sz of selectedSizes) {
      const result = await setSizeStatus(
        shoeId,
        sz,
        config.toStatus,
        botMeta(ctx, entry.name)
      );
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
    await ctx.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });
  });

  // Advance all eligible sizes
  bot.callbackQuery(/^u_al:([pad]):(.+)$/, async (ctx) => {
    const flowCode = ctx.match[1];
    const config = FLOW_CONFIGS[flowCode];
    if (!(await guardAction(ctx, config.roleRequired))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[2];
    const result = await advanceAllSizes(
      shoeId,
      config.toStatus,
      botMeta(ctx, entry.name)
    );
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
    await ctx.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });
  });

  // -----------------------------------------------------------------
  // /pending — PO approve/decline (purchaser+)
  // -----------------------------------------------------------------

  bot.command("pending", async (ctx) => {
    if (!(await guardAction(ctx, "purchaser"))) return;

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

    const pos =
      (data as {
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

      const kb = new InlineKeyboard()
        .text("Approve", `u_pa:${po.id}`)
        .text("Decline", `u_pd:${po.id}`);

      await ctx.reply(
        `*Draft PO*\nRetailer: ${escMd(retailer)}\nMax spend: $${escMd(maxDollars)}\nSizes: ${sizeCount}\nID: \`${escMd(po.id.slice(0, 8))}\``,
        { parse_mode: "MarkdownV2", reply_markup: kb }
      );
    }
  });

  // Approve PO
  bot.callbackQuery(/^u_pa:(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "purchaser"))) {
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
      .eq("status", "draft")
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
    const approved = data as {
      id: string;
      retailer_domain: string | null;
      max_amount_cents: number;
    };
    const maxDollars = (approved.max_amount_cents / 100).toFixed(2);
    await ctx.reply(
      `PO approved. The agent may now spend up to $${maxDollars} at ${approved.retailer_domain ?? "the retailer"}. Expires in 30 min.`
    );
  });

  // Decline PO
  bot.callbackQuery(/^u_pd:(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "purchaser"))) {
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
        error
          ? `Error declining PO: ${error.message}`
          : "PO not found or already processed."
      );
      return;
    }
    await ctx.reply("PO declined and cancelled.");
  });

  // -----------------------------------------------------------------
  // /sales — sales status management (admin)
  // -----------------------------------------------------------------

  bot.command("sales", async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) return;
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
      kb.text(label, `u_sp:${s.id}`).row();
    });
    await ctx.reply("Pick a shoe to change its sales status:", {
      reply_markup: kb,
    });
  });

  bot.callbackQuery(/^u_sp:(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const kb = new InlineKeyboard();
    STATUSES.forEach((s) => kb.text(s, `u_ss:${shoeId}:${s}`).row());
    await ctx.reply("Choose new sales status:", { reply_markup: kb });
  });

  bot.callbackQuery(/^u_ss:([^:]+):(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const newStatus = ctx.match[2] as ShoeStatus;
    const result = await setSalesStatus(
      shoeId,
      newStatus,
      botMeta(ctx, entry.name)
    );
    if (result.error) {
      await ctx.reply(`Error: ${result.error}`);
      return;
    }
    await ctx.reply(
      `Sales status set to *${escMd(newStatus)}* for "${escMd(result.shoe!.title)}"`,
      { parse_mode: "MarkdownV2" }
    );
  });

  // -----------------------------------------------------------------
  // /logistics — per-size drill-down corrections (admin)
  // -----------------------------------------------------------------

  bot.command("logistics", async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) return;
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
          ? szs
              .map(
                (sz) => `${sz.us_size}:${sz.logistics_status ?? "—"}`
              )
              .join(", ")
          : "no sizes";
      const label = `${s.title.slice(0, 28)} [${summary.slice(0, 18)}]`;
      kb.text(label, `u_lp:${s.id}`).row();
    });
    await ctx.reply("Pick a shoe to update per-size logistics status:", {
      reply_markup: kb,
    });
  });

  // Shoe selected -> show sizes
  bot.callbackQuery(/^u_lp:(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) {
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
      kb.text(
        `US ${sz.us_size} [${statusLabel}]`,
        `u_ls:${shoeId}:${sz.us_size}`
      ).row();
    });
    await ctx.reply("Pick a size to update:", { reply_markup: kb });
  });

  // Size selected -> show status options
  bot.callbackQuery(/^u_ls:([^:]+):(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const usSize = ctx.match[2];
    const kb = new InlineKeyboard();
    LOGISTICS.forEach((s) =>
      kb.text(s, `u_lt:${shoeId}:${usSize}:${s}`).row()
    );
    kb.text(
      "clear (not started)",
      `u_lt:${shoeId}:${usSize}:null`
    ).row();
    await ctx.reply(`Set logistics status for US ${usSize}:`, {
      reply_markup: kb,
    });
  });

  // Set logistics status
  bot.callbackQuery(/^u_lt:([^:]+):([^:]+):(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const usSize = ctx.match[2];
    const rawStatus = ctx.match[3];
    const toStatus: LogisticsStatus | null =
      rawStatus === "null" ? null : (rawStatus as LogisticsStatus);
    const result = await setSizeStatus(
      shoeId,
      usSize,
      toStatus,
      botMeta(ctx, entry.name)
    );
    if (result.error) {
      await ctx.reply(`Error: ${result.error}`);
      return;
    }
    const label = toStatus ?? "cleared (not started)";
    await ctx.reply(`US ${usSize} → ${label}`);
  });

  // -----------------------------------------------------------------
  // /list — full pipeline overview (admin)
  // -----------------------------------------------------------------

  bot.command("list", async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) return;
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
          ? szs
              .map(
                (sz) => `${sz.us_size}:${sz.logistics_status ?? "—"}`
              )
              .join(", ")
          : "no sizes";
      return `• [${s.status}] ${s.title.slice(0, 50)} — ${logSummary}`;
    });
    await ctx.reply(
      `Pipeline (${shoes.length} shoes):\n\n` + lines.join("\n")
    );
  });

  // -----------------------------------------------------------------
  // /edit — shoe field editing (admin)
  // -----------------------------------------------------------------

  bot.command("edit", async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) return;
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
      reply_markup: buildShoePickerKb(shoes, "u_ep"),
    });
  });

  // Shoe selected -> field menu
  bot.callbackQuery(/^u_ep:(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const kb = new InlineKeyboard()
      .text("Title", `u_ef:${shoeId}:title`)
      .text("Brand", `u_ef:${shoeId}:brand`)
      .row()
      .text("Price", `u_ef:${shoeId}:price`)
      .text("Notes", `u_ef:${shoeId}:notes`)
      .row()
      .text("Sizes", `u_ef:${shoeId}:sizes`)
      .text("Sales status", `u_ef:${shoeId}:sales`);
    await ctx.reply("What do you want to edit?", { reply_markup: kb });
  });

  // Field chosen
  bot.callbackQuery(/^u_ef:([^:]+):(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const fieldToken = ctx.match[2];

    const { shoes } = await getAllShoes();
    const shoe = shoes.find((s) => s.id === shoeId);
    const title = shoe?.title ?? "this shoe";

    if (fieldToken === "sales") {
      const kb = new InlineKeyboard();
      STATUSES.forEach((s) => kb.text(s, `u_es:${shoeId}:${s}`).row());
      await ctx.reply(`Choose new sales status for "${title}":`, {
        reply_markup: kb,
      });
      return;
    }

    if (fieldToken === "sizes") {
      await ctx.reply(
        `\u{1F4D0} New size list for ${title} [id:${shoeId}] — reply with the sizes (e.g. "8, 9, 10.5"). [u_edit:sizes:${shoeId}]`,
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
      `✏️ New ${fieldLabel} for ${title} [id:${shoeId}] — reply with the value. [u_edit:${fieldToken}:${shoeId}]`,
      { reply_markup: { force_reply: true } }
    );
  });

  // Sales status chosen via edit
  bot.callbackQuery(/^u_es:([^:]+):(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const newStatus = ctx.match[2] as ShoeStatus;
    const result = await setSalesStatus(
      shoeId,
      newStatus,
      botMeta(ctx, entry.name)
    );
    if (result.error) {
      await ctx.reply(`Error: ${result.error}`);
      return;
    }
    await ctx.reply(
      `Sales status set to *${escMd(newStatus)}* for "${escMd(result.shoe!.title)}"`,
      { parse_mode: "MarkdownV2" }
    );
  });

  // -----------------------------------------------------------------
  // /remove — soft-remove (admin)
  // -----------------------------------------------------------------

  bot.command("remove", async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) return;
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
      reply_markup: buildShoePickerKb(shoes, "u_rp"),
    });
  });

  bot.callbackQuery(/^u_rp:(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const { shoes } = await getAllShoes();
    const shoe = shoes.find((s) => s.id === shoeId);
    const title = shoe?.title ?? "this shoe";
    const kb = new InlineKeyboard()
      .text("Yes, remove", `u_ry:${shoeId}`)
      .text("No, cancel", "u_rn");
    await ctx.reply(
      `Remove "${title}"? It will be hidden from the storefront (the record is kept).`,
      { reply_markup: kb }
    );
  });

  bot.callbackQuery(/^u_rn$/, async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery("Cancelled.");
    await ctx.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });
    await ctx.reply("Removal cancelled.");
  });

  bot.callbackQuery(/^u_ry:(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const result = await softRemoveShoe(shoeId, botMeta(ctx, entry.name));
    await ctx.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });
    if (result.error) {
      await ctx.reply(`Error: ${result.error}`);
      return;
    }
    await ctx.reply("Done — the shoe is now hidden from the storefront.");
  });

  // -----------------------------------------------------------------
  // /copy — edit website copy (admin)
  // -----------------------------------------------------------------

  bot.command("copy", async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) return;
    const kb = new InlineKeyboard();
    COPY_KEYS.forEach((k) => kb.text(k, `u_ck:${k}`).row());
    await ctx.reply("Pick a website copy key to edit:", { reply_markup: kb });
  });

  bot.callbackQuery(/^u_ck:(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const key = ctx.match[1] as SiteCopyKey;
    const copy = await getSiteCopy();
    const en = getCopy(copy, key, "en");
    const am = getCopy(copy, key, "am");
    const kb = new InlineKeyboard()
      .text("English", `u_cl:${key}:en`)
      .text("Amharic", `u_cl:${key}:am`);
    await ctx.reply(
      `Editing "${key}".\nCurrent EN: ${en || "—"}\nCurrent AM: ${am || "—"}\n\nPick a language:`,
      { reply_markup: kb }
    );
  });

  bot.callbackQuery(/^u_cl:([^:]+):(en|am)$/, async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const key = ctx.match[1] as SiteCopyKey;
    const lang = ctx.match[2] as SiteCopyLang;
    await ctx.reply(
      `\u{1F4DD} New value for ${key} (${lang}) — reply with the text. [u_copy:${key}:${lang}]`,
      { reply_markup: { force_reply: true } }
    );
  });

  // -----------------------------------------------------------------
  // /setprice — birr price (admin)
  // -----------------------------------------------------------------

  bot.command("setprice", async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) return;
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
      reply_markup: buildShoePickerKb(shoes, "u_pp"),
    });
  });

  bot.callbackQuery(/^u_pp:(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const { shoes } = await getAllShoes();
    const shoe = shoes.find((s) => s.id === shoeId);
    const title = shoe?.title ?? "this shoe";
    const current =
      shoe?.price_etb != null ? `ብር ${shoe.price_etb}` : "not set";
    await ctx.reply(
      `\u{1F4B5} New price (birr) for ${title} — current: ${current}. Reply with a whole birr amount (e.g. 18500), or "none" to clear. [u_setprice:${shoeId}]`,
      { reply_markup: { force_reply: true } }
    );
  });

  // -----------------------------------------------------------------
  // Video upload — send video -> pick shoe -> upload (admin)
  // -----------------------------------------------------------------

  const MAX_VIDEO_BYTES = 19 * 1024 * 1024;
  const VIDEO_TOO_BIG_MSG =
    "That video is over Telegram's 20MB bot download limit. " +
    "Please compress or trim it to under 19MB and send it again.";

  async function handleIncomingVideo(
    ctx: Context,
    fileSize: number | undefined
  ) {
    if (!(await guardAction(ctx, "admin"))) return;
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
      reply_markup: buildShoePickerKb(shoes, "u_vp"),
      reply_parameters: { message_id: ctx.message!.message_id },
    });
  }

  bot.on("message:video", async (ctx) => {
    if (!isAuthorizedChat(ctx)) return;
    await handleIncomingVideo(ctx, ctx.message.video.file_size);
  });

  bot.on("message:document", async (ctx) => {
    if (!isAuthorizedChat(ctx)) return;
    const doc = ctx.message.document;
    if (!doc.mime_type?.startsWith("video/")) return;
    await handleIncomingVideo(ctx, doc.file_size);
  });

  // Shoe selected for video -> download + upload + set URL
  bot.callbackQuery(/^u_vp:(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];

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

    await ctx.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });
    const status = await ctx.reply("Uploading video…");
    const done = (text: string) =>
      ctx.api.editMessageText(status.chat.id, status.message_id, text);

    try {
      const file = await ctx.api.getFile(fileId);
      if (!file.file_path) {
        await done(
          "Telegram did not return a download path for that video. Please try again."
        );
        return;
      }
      const res = await fetch(
        `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`
      );
      if (!res.ok) {
        await done(
          `Error downloading the video from Telegram (HTTP ${res.status}).`
        );
        return;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      const upload = await uploadShoeVideo(shoeId, buffer, contentType);
      if (upload.error !== null) {
        await done(`Error uploading to storage: ${upload.error}`);
        return;
      }
      const result = await setVideoUrl(
        shoeId,
        upload.url,
        botMeta(ctx, entry.name)
      );
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

  // -----------------------------------------------------------------
  // /clearvideo (admin)
  // -----------------------------------------------------------------

  bot.command("clearvideo", async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) return;
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
      reply_markup: buildShoePickerKb(withVideo, "u_vc"),
    });
  });

  bot.callbackQuery(/^u_vc:(.+)$/, async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[1];
    const result = await setVideoUrl(
      shoeId,
      null,
      botMeta(ctx, entry.name)
    );
    if (result.error) {
      await ctx.reply(`Error: ${result.error}`);
      return;
    }
    await ctx.reply(`Video cleared for "${result.shoe!.title}".`);
  });

  // -----------------------------------------------------------------
  // Photo match — send photo -> pick flow -> AI match -> confirm
  // -----------------------------------------------------------------

  bot.on("message:photo", async (ctx) => {
    if (!isAuthorizedChat(ctx)) return;
    // Light check: is the sender in telegram_users at all?
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    const authCheck = await checkAllowlist(telegramId, "unified", "shipper");
    // If not a shipper, try purchaser
    const authCheck2 = authCheck.allowed
      ? authCheck
      : await checkAllowlist(telegramId, "unified", "purchaser");
    if (!authCheck.allowed && !authCheck2.allowed) {
      // Not authorized for any pipeline role — ignore the photo silently
      return;
    }

    const kb = new InlineKeyboard()
      .text("Purchase (in_cart → purchased)", "u_pf:p")
      .row()
      .text("Arrival (purchased → arrived)", "u_pf:a")
      .row()
      .text("Delivery (arrived → delivered)", "u_pf:d");

    await ctx.reply("What flow is this photo for?", {
      reply_markup: kb,
      reply_parameters: { message_id: ctx.message.message_id },
    });
  });

  // Flow selected -> run AI matching
  bot.callbackQuery(/^u_pf:([pad])$/, async (ctx) => {
    const flowCode = ctx.match[1];
    const config = FLOW_CONFIGS[flowCode];
    if (!(await guardAction(ctx, config.roleRequired))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();

    // Recover the photo from reply_to_message (the flow selector was a reply to the photo)
    const pickerMsg = ctx.callbackQuery.message;
    const photoMsg =
      pickerMsg && "reply_to_message" in pickerMsg
        ? pickerMsg.reply_to_message
        : undefined;
    const photoSizes = photoMsg?.photo;
    if (!photoSizes || photoSizes.length === 0) {
      await ctx.reply(
        "Could not find the original photo. Please send the photo again."
      );
      return;
    }

    // Get candidates for this flow
    const { shoes: candidates, error: fetchError } =
      await getShoesByLogistics(config.fromStatus);
    if (fetchError) {
      await ctx.reply(
        "Error fetching candidate shoes. Please try again."
      );
      return;
    }
    if (candidates.length === 0) {
      await ctx.reply(
        `No shoes with sizes at "${config.fromStatus}". Nothing to match.`
      );
      return;
    }

    const largest = photoSizes[photoSizes.length - 1];
    if (!largest) {
      await ctx.reply("Could not read the photo. Please try again.");
      return;
    }

    // Dismiss the flow-selector keyboard
    await ctx.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });
    const statusMsg = await ctx.reply("Analyzing photo...");
    const done = (text: string) =>
      ctx.api
        .editMessageText(statusMsg.chat.id, statusMsg.message_id, text)
        .catch(() => ctx.reply(text));

    try {
      const file = await ctx.api.getFile(largest.file_id);
      if (!file.file_path) {
        await done(
          "Telegram did not return a download path for that photo. Please try again."
        );
        return;
      }
      const photoRes = await fetch(
        `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`
      );
      if (!photoRes.ok) {
        await done(
          `Error downloading the photo from Telegram (HTTP ${photoRes.status}).`
        );
        return;
      }
      const photoBuffer = Buffer.from(await photoRes.arrayBuffer());
      const photoBase64 = photoBuffer.toString("base64");

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
          "No matching shoes found in the catalog. Use the pipeline command to manually select."
        );
        return;
      }

      const kb = new InlineKeyboard();
      for (const match of topMatches) {
        const confLabel =
          match.confidence === "high"
            ? "Strong match"
            : match.confidence === "medium"
              ? "Possible match"
              : "Weak match";
        const btnLabel = `${confLabel}: ${match.title.slice(0, 30)} — advance?`;
        kb.text(btnLabel, `u_pm:${flowCode}:${match.shoeId}`).row();
      }
      kb.text("None of these", "u_pn");

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

  // Confirm photo match -> advance all eligible sizes
  bot.callbackQuery(/^u_pm:([pad]):(.+)$/, async (ctx) => {
    const flowCode = ctx.match[1];
    const config = FLOW_CONFIGS[flowCode];
    if (!(await guardAction(ctx, config.roleRequired))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    const shoeId = ctx.match[2];
    const result = await advanceAllSizes(
      shoeId,
      config.toStatus,
      botMeta(ctx, entry.name)
    );
    await ctx.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });
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

  // Reject all matches
  bot.callbackQuery(/^u_pn$/, async (ctx) => {
    if (!isAuthorizedChat(ctx)) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery("Match rejected.");
    await ctx.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });
    await ctx.reply(
      "No match confirmed. Use the pipeline command to manually select a shoe."
    );
  });

  // -----------------------------------------------------------------
  // Tier-2 NL helpers (admin, opt-in)
  // -----------------------------------------------------------------

  async function handleNlFreeText(
    ctx: Context,
    text: string
  ): Promise<void> {
    if (!(await guardAction(ctx, "admin"))) return;

    if (
      process.env.SITE_EDIT_NL_ENABLED !== "true" ||
      !process.env.ANTHROPIC_API_KEY
    ) {
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
      await ctx.reply(
        "Sorry, I couldn't turn that into a change. Try rephrasing, or use /edit, /remove, or /copy."
      );
      return;
    }
    if ("clarify" in intent) {
      await ctx.reply(intent.clarify);
      return;
    }

    const titleById = new Map(
      shoes.map((s) => [s.id, s.title] as const)
    );
    const summary = summarizeNlCommand(intent, titleById);
    const kb = new InlineKeyboard()
      .text("Yes, apply", "u_ny")
      .text("No, cancel", "u_nn");
    await ctx.reply(
      `Apply this change: ${summary}?\n${encodeNlTag(intent)}`,
      { reply_markup: kb }
    );
  }

  async function applyNlCommand(
    ctx: Context,
    cmd: NlCommand
  ): Promise<void> {
    const meta = botMeta(ctx, entry.name);
    switch (cmd.command) {
      case "edit_field": {
        const result = await updateShoeField(
          cmd.args.shoe_id,
          cmd.args.field,
          cmd.args.value,
          meta
        );
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
        const result = await setSalesStatus(
          cmd.args.shoe_id,
          cmd.args.status,
          meta
        );
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
        await ctx.reply(
          `Website copy "${cmd.args.key}" (${cmd.args.lang}) updated.`
        );
        return;
      }
      case "remove_shoe": {
        const result = await softRemoveShoe(cmd.args.shoe_id, meta);
        if (result.error) {
          await ctx.reply(`Error: ${result.error}`);
          return;
        }
        await ctx.reply(
          "Done — the shoe is now hidden from the storefront."
        );
        return;
      }
      case "set_price_etb": {
        const result = await setPriceEtb(
          cmd.args.shoe_id,
          cmd.args.price_etb,
          meta
        );
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
        const result = await setVideoUrl(
          cmd.args.shoe_id,
          null,
          meta
        );
        if (result.error) {
          await ctx.reply(`Error: ${result.error}`);
          return;
        }
        await ctx.reply(`Video cleared for "${result.shoe!.title}".`);
        return;
      }
    }
  }

  // NL Yes -> apply
  bot.callbackQuery(/^u_ny$/, async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });
    const cmd = decodeNlTag(ctx.callbackQuery.message?.text);
    if (!cmd) {
      await ctx.reply(
        "This confirmation expired — please send the request again."
      );
      return;
    }
    await applyNlCommand(ctx, cmd);
  });

  // NL No -> cancel
  bot.callbackQuery(/^u_nn$/, async (ctx) => {
    if (!(await guardAction(ctx, "admin"))) {
      await ctx.answerCallbackQuery("Access denied.");
      return;
    }
    await ctx.answerCallbackQuery("Cancelled.");
    await ctx.editMessageReplyMarkup({
      reply_markup: { inline_keyboard: [] },
    });
    await ctx.reply("Cancelled — no change made.");
  });

  // -----------------------------------------------------------------
  // Stateless free-text capture — the ONLY message:text handler.
  //
  // Three paths, mutually exclusive:
  //  1. Reply carrying a [u_edit:...] / [u_copy:...] / [u_setprice:...] tag
  //     -> ForceReply capture (Tier-1 structured edit).
  //  2. Plain free text (not a reply, not a /command) -> Tier-2 NL editing.
  //  3. Everything else -> ignored.
  // -----------------------------------------------------------------

  bot.on("message:text", async (ctx) => {
    if (!isAuthorizedChat(ctx)) return;

    const promptText = ctx.message.reply_to_message?.text;

    // ----- Tier-2: plain free text (not a reply, not a slash command) -----
    if (!promptText) {
      const text = ctx.message.text.trim();
      if (text.startsWith("/")) return; // slash command handled above
      await handleNlFreeText(ctx, text);
      return;
    }

    // Check for ForceReply tags
    const editMatch = promptText.match(/\[u_edit:([^:\]]+):([^\]]+)\]/);
    const copyMatch = promptText.match(/\[u_copy:([^:\]]+):(en|am)\]/);
    const setPriceMatch = promptText.match(/\[u_setprice:([^\]]+)\]/);
    if (!editMatch && !copyMatch && !setPriceMatch) return; // not ours

    // Re-verify admin before mutating
    if (!(await guardAction(ctx, "admin"))) return;

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
      await ctx.reply(
        `Price set for "${result.shoe!.title}" — ብር ${Number(digits)}`
      );
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
        await ctx.reply(
          "Unknown field — please start again with /edit."
        );
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
    const result = await setCopy(
      key,
      lang,
      value,
      meta.actorLabel ?? "ops"
    );
    if (result.error) {
      await ctx.reply(`Error: ${result.error}`);
      return;
    }
    await ctx.reply(`Website copy "${key}" (${lang}) updated.`);
  });
}
