/**
 * app/api/webhooks/chapa/route.ts — Chapa payment webhook receiver.
 *
 * Chapa POSTs here when a transaction completes (or fails). The URL registered
 * in the Chapa dashboard must be:
 *   https://sole-supply2.vercel.app/api/webhooks/chapa
 *
 * Security model (fail-closed):
 *   1. Read the raw body FIRST (needed for HMAC verification).
 *   2. Verify HMAC-SHA256 of the raw body against CHAPA_WEBHOOK_SECRET
 *      (Chapa sends this in the "Chapa-Signature" header).
 *      Any failure → 403, no DB writes.
 *   3. Extract tx_ref from the parsed body.
 *   4. Call verifyChapa(tx_ref) — always re-verify via Chapa's API before
 *      marking paid. Never trust the webhook body's status field alone.
 *   5. Return 200 (Chapa expects 200 even on our internal errors so it does
 *      not retry indefinitely — log errors instead of propagating them).
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyChapaWebhookSig, verifyChapa } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // 1. Read raw body before anything else — needed for HMAC verification.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "failed to read body" }, { status: 400 });
  }

  // 2. Verify Chapa webhook signature (fail-closed).
  const sigHeader = req.headers.get("Chapa-Signature");
  const valid = await verifyChapaWebhookSig(sigHeader, rawBody);
  if (!valid) {
    console.warn("[chapa-webhook] rejected — invalid or missing signature");
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 3. Parse body + extract tx_ref.
  let body: { tx_ref?: string; [key: string]: unknown };
  try {
    body = JSON.parse(rawBody) as { tx_ref?: string; [key: string]: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const txRef = typeof body.tx_ref === "string" ? body.tx_ref.trim() : "";
  if (!txRef) {
    return NextResponse.json({ error: "missing tx_ref" }, { status: 400 });
  }

  // 4. Re-verify via Chapa's verify endpoint (source of truth).
  //    We do NOT trust body.status — we always call verify first.
  const result = await verifyChapa(txRef);
  if (result.error) {
    // Log but return 200 so Chapa does not keep retrying.
    console.error(
      `[chapa-webhook] verifyChapa failed for tx_ref=${txRef}:`,
      result.error
    );
  }

  // 5. Acknowledge to Chapa.
  return NextResponse.json({ ok: true });
}
