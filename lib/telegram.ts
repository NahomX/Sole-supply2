/**
 * lib/telegram.ts — low-level helpers shared across bot handlers and the
 * stale-digest cron. grammY handles the high-level bot API; these helpers
 * exist for the one case (cron digest) that sends a plain message without
 * a grammY Bot instance.
 */

/**
 * Send a plain text message to a chat via the Telegram Bot API.
 * Used by the stale-digest cron (and available to ops bot for broadcast).
 *
 * @param timeoutMs - Optional AbortController timeout in ms. When provided,
 *   the fetch is aborted if it does not complete within that window. Callers
 *   that need a hard deadline (e.g. ops feed inside a serverless function)
 *   should pass a small value such as 3000. The default (undefined) means no
 *   timeout, preserving the existing behaviour for the stale-digest cron.
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string | number,
  text: string,
  parseMode?: "HTML" | "MarkdownV2",
  timeoutMs?: number
): Promise<boolean> {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;

  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs !== undefined) {
    controller = new AbortController();
    timer = setTimeout(() => controller!.abort(), timeoutMs);
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller?.signal,
      }
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[telegram] sendMessage error:", res.status, detail);
    }
    return res.ok;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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
