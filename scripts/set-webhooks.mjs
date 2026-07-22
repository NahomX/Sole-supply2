#!/usr/bin/env node
/**
 * scripts/set-webhooks.mjs — Register (or clear) Telegram webhooks for all bots.
 *
 * Usage:
 *   node scripts/set-webhooks.mjs register <VERCEL_URL>
 *   node scripts/set-webhooks.mjs clear
 *   node scripts/set-webhooks.mjs info
 *
 * Prerequisites:
 *   - All bot token env vars set in your shell (or .env.local loaded separately).
 *   - TELEGRAM_WEBHOOK_SECRET set in your shell.
 *
 * Examples:
 *   CUSTOMER_BOT_TOKEN=... INCART_BOT_TOKEN=... ... TELEGRAM_WEBHOOK_SECRET=... \
 *     node scripts/set-webhooks.mjs register https://sole-supply2.vercel.app
 *
 * The script reads tokens from environment variables. It does NOT read .env.local
 * automatically — pipe them in or export them first.
 */

// Bot registry — must stay in sync with lib/bots/registry.ts
const BOTS = [
  { name: "customer",  tokenEnvVar: "CUSTOMER_BOT_TOKEN" },
  { name: "incart",    tokenEnvVar: "INCART_BOT_TOKEN" },
  { name: "purchaser", tokenEnvVar: "PURCHASER_BOT_TOKEN" },
  { name: "arrived",   tokenEnvVar: "ARRIVED_BOT_TOKEN" },
  { name: "delivery",  tokenEnvVar: "DELIVERY_BOT_TOKEN" },
  { name: "ops",       tokenEnvVar: "OPS_BOT_TOKEN" },
  { name: "unified",   tokenEnvVar: "UNIFIED_BOT_TOKEN" },
];

const [,, command, vercelUrl] = process.argv;

if (!["register", "clear", "info"].includes(command)) {
  console.error("Usage: node scripts/set-webhooks.mjs register <VERCEL_URL> | clear | info");
  process.exit(1);
}

const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (command === "register" && !webhookSecret) {
  console.error("TELEGRAM_WEBHOOK_SECRET is not set.");
  process.exit(1);
}
if (command === "register" && !vercelUrl) {
  console.error("Usage: node scripts/set-webhooks.mjs register <VERCEL_URL>");
  process.exit(1);
}

async function tgApi(token, method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

for (const bot of BOTS) {
  const token = process.env[bot.tokenEnvVar];
  if (!token) {
    console.warn(`[${bot.name}] SKIP — ${bot.tokenEnvVar} is not set.`);
    continue;
  }

  if (command === "info") {
    const info = await tgApi(token, "getWebhookInfo");
    console.log(`[${bot.name}]`, JSON.stringify(info.result ?? info, null, 2));
    continue;
  }

  if (command === "clear") {
    const res = await tgApi(token, "deleteWebhook");
    console.log(`[${bot.name}] deleteWebhook:`, res.ok ? "OK" : JSON.stringify(res));
    continue;
  }

  // register
  const baseUrl = vercelUrl.replace(/\/$/, "");
  const webhookUrl = `${baseUrl}/api/telegram/${bot.name}`;
  const res = await tgApi(token, "setWebhook", {
    url: webhookUrl,
    secret_token: webhookSecret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  if (res.ok) {
    console.log(`[${bot.name}] Webhook set: ${webhookUrl}`);
  } else {
    console.error(`[${bot.name}] FAILED:`, JSON.stringify(res));
  }
}
