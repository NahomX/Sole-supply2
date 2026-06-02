/**
 * lib/telegram.ts — low-level helpers shared across bot handlers and the
 * stale-digest cron. grammY handles the high-level bot API; these helpers
 * exist for the one case (cron digest) that sends a plain message without
 * a grammY Bot instance.
 */

/**
 * Send a plain text message to a chat via the Telegram Bot API.
 * Used by the stale-digest cron (and available to ops bot for broadcast).
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string | number,
  text: string,
  parseMode?: "HTML" | "MarkdownV2"
): Promise<boolean> {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;

  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[telegram] sendMessage error:", res.status, detail);
  }
  return res.ok;
}

/**
 * Verify the secret-token header Telegram sends on every webhook update.
 * Returns true if the header matches the configured secret, false otherwise.
 * If no secret is configured this always returns false (fail-closed).
 */
export function verifyWebhookSecret(
  headerValue: string | null,
  expectedSecret: string | undefined
): boolean {
  if (!expectedSecret) return false;
  return headerValue === expectedSecret;
}
