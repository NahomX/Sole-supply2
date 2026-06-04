/**
 * lib/payments.ts — Chapa payment integration helpers (server-only, admin POC).
 *
 * This module is intentionally server-only. It imports supabaseService() which
 * holds the service-role key — NEVER import this from a "use client" component.
 *
 * Flow:
 *   1. Admin calls initChapa() → inserts a pending payments row + unique tx_ref
 *      → POSTs to Chapa initialize → returns checkout_url.
 *   2. Customer (test mode) completes payment on Chapa's hosted page.
 *   3. Chapa POSTs to /api/webhooks/chapa → verifyChapaWebhookSig() → verifyChapa(tx_ref).
 *   4. verifyChapa() calls the Chapa verify endpoint (source of truth), then
 *      updates the payments row to paid/failed and posts to the ops feed.
 *
 * SECURITY:
 *   - CHAPA_SECRET_KEY is server-only (never NEXT_PUBLIC_).
 *   - CHAPA_WEBHOOK_SECRET is server-only.
 *   - Webhook handler is fail-closed: bad/missing signature → 403, no DB write.
 *   - verifyChapa() is always called before marking paid — we never trust the
 *     redirect or webhook body alone.
 *   - The payments table has RLS enabled with NO public/authenticated policies,
 *     so no row is ever readable via the anon key.
 */

import { supabaseService } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/telegram";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChapaInitInput = {
  shoeId?: string | null;
  size?: string | null;
  amount: number;
  email: string;
};

export type ChapaInitResult =
  | { checkoutUrl: string; txRef: string; error: null }
  | { checkoutUrl: null; txRef: null; error: string };

export type ChapaVerifyResult =
  | { status: "paid" | "failed"; error: null }
  | { status: null; error: string };

// ---------------------------------------------------------------------------
// Internal ops-feed helper (mirrors lib/shoes.ts postOpsFeed pattern).
// Fire-and-forget; never throws or blocks a payment transition.
// ---------------------------------------------------------------------------

async function postPaymentsOpsFeed(text: string): Promise<void> {
  const token = process.env.OPS_BOT_TOKEN;
  const chatId = process.env.OPS_FEED_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await sendTelegramMessage(token, chatId, text, undefined, 3000);
  } catch {
    console.error("[payments-ops-feed] failed to send message");
  }
}

// ---------------------------------------------------------------------------
// initChapa — create a pending payment row + start the Chapa checkout.
// ---------------------------------------------------------------------------

/**
 * Creates a pending payment row in the DB, then calls the Chapa initialize
 * endpoint. Returns the checkout_url to redirect the admin to Chapa's hosted
 * payment page (test mode).
 */
export async function initChapa(
  input: ChapaInitInput
): Promise<ChapaInitResult> {
  const secretKey = process.env.CHAPA_SECRET_KEY;
  if (!secretKey) {
    return {
      checkoutUrl: null,
      txRef: null,
      error: "CHAPA_SECRET_KEY not configured",
    };
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    "https://sole-supply2.vercel.app";

  // Unique tx_ref: "ss-<timestamp>-<random 8 hex chars>"
  const txRef = `ss-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

  // 1. Insert a pending row before calling Chapa — if Chapa fails we still
  //    have a record of the attempt.
  const db = supabaseService();
  const { error: insertError } = await db.from("payments").insert({
    shoe_id: input.shoeId ?? null,
    size: input.size ?? null,
    amount: input.amount,
    currency: "ETB",
    tx_ref: txRef,
    status: "pending",
    customer_email: input.email,
  });

  if (insertError) {
    return {
      checkoutUrl: null,
      txRef: null,
      error: `DB insert failed: ${insertError.message}`,
    };
  }

  // 2. Call Chapa initialize.
  const chapaBody = {
    amount: input.amount.toString(),
    currency: "ETB",
    tx_ref: txRef,
    email: input.email,
    first_name: "Admin",
    callback_url: `${siteUrl}/api/webhooks/chapa`,
    return_url: `${siteUrl}/admin`,
  };

  let checkoutUrl: string;
  try {
    const res = await fetch("https://api.chapa.co/v1/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chapaBody),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // Mark the DB row failed — Chapa rejected the initialization.
      await db
        .from("payments")
        .update({ status: "failed" })
        .eq("tx_ref", txRef);
      return {
        checkoutUrl: null,
        txRef: null,
        error: `Chapa initialize error ${res.status}: ${detail}`,
      };
    }

    const json = (await res.json()) as {
      data?: { checkout_url?: string };
    };
    checkoutUrl = json?.data?.checkout_url ?? "";
    if (!checkoutUrl) {
      await db
        .from("payments")
        .update({ status: "failed" })
        .eq("tx_ref", txRef);
      return {
        checkoutUrl: null,
        txRef: null,
        error: "Chapa returned no checkout_url",
      };
    }
  } catch (err) {
    await db
      .from("payments")
      .update({ status: "failed" })
      .eq("tx_ref", txRef);
    return {
      checkoutUrl: null,
      txRef: null,
      error: `Chapa initialize fetch failed: ${String(err)}`,
    };
  }

  return { checkoutUrl, txRef, error: null };
}

// ---------------------------------------------------------------------------
// verifyChapa — re-verify via Chapa's verify endpoint (source of truth).
// ---------------------------------------------------------------------------

/**
 * Calls GET https://api.chapa.co/v1/transaction/verify/<tx_ref> to
 * authoritatively confirm payment. Updates the payments row to paid/failed
 * and posts to the ops feed.
 *
 * ALWAYS call this before marking a payment paid — never trust the webhook
 * body or the redirect alone.
 */
export async function verifyChapa(txRef: string): Promise<ChapaVerifyResult> {
  const secretKey = process.env.CHAPA_SECRET_KEY;
  if (!secretKey) {
    return { status: null, error: "CHAPA_SECRET_KEY not configured" };
  }

  let finalStatus: "paid" | "failed";
  let chapaRef: string | null = null;

  try {
    const res = await fetch(
      `https://api.chapa.co/v1/transaction/verify/${encodeURIComponent(txRef)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${secretKey}` },
      }
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        status: null,
        error: `Chapa verify error ${res.status}: ${detail}`,
      };
    }

    const json = (await res.json()) as {
      data?: { status?: string; reference?: string };
      status?: string;
    };
    // Chapa returns data.status:"success" on paid.
    const chapaStatus = json?.data?.status ?? json?.status ?? "failed";
    chapaRef = json?.data?.reference ?? null;
    finalStatus = chapaStatus === "success" ? "paid" : "failed";
  } catch (err) {
    return {
      status: null,
      error: `Chapa verify fetch failed: ${String(err)}`,
    };
  }

  // Update the payments row.
  const db = supabaseService();
  const { error: updateError } = await db
    .from("payments")
    .update({
      status: finalStatus,
      chapa_ref: chapaRef,
    })
    .eq("tx_ref", txRef);

  if (updateError) {
    console.error("[payments] DB update failed:", updateError.message);
    // Don't fail the webhook — log and continue.
  }

  // Post to ops feed (fire-and-forget).
  await postPaymentsOpsFeed(
    `\u{1F4B3} test payment ${txRef} — ${finalStatus}`
  );

  return { status: finalStatus, error: null };
}

// ---------------------------------------------------------------------------
// verifyChapaWebhookSig — validate the Chapa webhook signature header.
// ---------------------------------------------------------------------------

/**
 * Verify the Chapa webhook signature. Chapa sends a "Chapa-Signature" header
 * containing the HMAC-SHA256 hex digest of the raw body, keyed with
 * CHAPA_WEBHOOK_SECRET.
 *
 * Returns true only if the signature is valid and the secret is configured.
 * Fail-closed: any missing secret, missing header, or mismatch → false.
 *
 * The caller reads the raw body BEFORE calling this so both the signature check
 * and JSON parsing can use the same body string.
 */
export async function verifyChapaWebhookSig(
  sigHeader: string | null,
  rawBody: string
): Promise<boolean> {
  const secret = process.env.CHAPA_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      "[payments] CHAPA_WEBHOOK_SECRET not configured — rejecting webhook"
    );
    return false;
  }

  if (!sigHeader) {
    return false;
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const hexSig = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Manual constant-time comparison (avoids short-circuit on length diff).
  if (hexSig.length !== sigHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < hexSig.length; i++) {
    diff |= hexSig.charCodeAt(i) ^ sigHeader.charCodeAt(i);
  }
  return diff === 0;
}
