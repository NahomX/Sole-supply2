/**
 * app/api/telegram/[bot]/route.ts — Dynamic Telegram webhook dispatcher.
 *
 * The [bot] path segment selects a registry entry. On each POST:
 *   1. Look up the registry entry by name — 404 if unknown.
 *   2. Verify the X-Telegram-Bot-Api-Secret-Token header — 403 if wrong.
 *   3. Read the bot token from the env var named in the registry entry.
 *   4. Build a grammY Bot, register handlers for that bot type, dispatch.
 *
 * All bot tokens and the shared webhook secret are server-only env vars.
 * This route never leaks them to the client.
 */

import { NextRequest, NextResponse } from "next/server";
import { Bot, webhookCallback } from "grammy";
import { getBotEntry } from "@/lib/bots/registry";
import { verifyWebhookSecret } from "@/lib/telegram";
import {
  registerCustomerBot,
  registerIncartBot,
  registerWorkBot,
  registerOpsBot,
} from "@/lib/bots/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { bot: string } }
) {
  const botName = params.bot;

  // 1. Registry lookup.
  const entry = getBotEntry(botName);
  if (!entry) {
    return NextResponse.json({ error: "unknown bot" }, { status: 404 });
  }

  // 2. Webhook secret verification (fail-closed).
  const secretHeader = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!verifyWebhookSecret(secretHeader, webhookSecret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 3. Bot token.
  const token = process.env[entry.tokenEnvVar];
  if (!token) {
    console.error(`[telegram-webhook] Missing env var: ${entry.tokenEnvVar}`);
    return NextResponse.json({ error: "bot not configured" }, { status: 500 });
  }

  // 4. Build bot + register handlers + dispatch.
  const bot = new Bot(token);

  switch (entry.name) {
    case "customer":
      registerCustomerBot(bot, entry);
      break;
    case "incart":
      registerIncartBot(bot, entry);
      break;
    case "purchaser":
    case "arrived":
    case "delivery":
      registerWorkBot(bot, entry);
      break;
    case "ops":
      registerOpsBot(bot, entry);
      break;
    default:
      return NextResponse.json({ error: "unhandled bot" }, { status: 500 });
  }

  // grammY's webhookCallback reads the raw request body and dispatches updates.
  try {
    const handler = webhookCallback(bot, "std/http");
    return await handler(req);
  } catch (err) {
    console.error("[telegram-webhook] handler error:", err);
    return NextResponse.json({ error: "handler error" }, { status: 500 });
  }
}
