/**
 * app/api/admin/test-payment/route.ts — Initiate a Chapa test payment.
 *
 * POST body: { shoe_id?: string, size?: string, amount: number, email: string }
 * Response:  { checkout_url: string, tx_ref: string }
 *
 * Security gates (both must pass):
 *   1. requireRole(["admin"]) — only admins may initiate test payments.
 *   2. PAYMENTS_POC_ENABLED === "true" — feature flag; off by default.
 *
 * This route is NOT exposed to customers or shippers. The public storefront
 * has no payment UI — this is a behind-the-scenes admin POC only.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { initChapa } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // 1. Feature flag — must be explicitly enabled.
  if (process.env.PAYMENTS_POC_ENABLED !== "true") {
    return NextResponse.json(
      { error: "payments poc is not enabled" },
      { status: 404 }
    );
  }

  // 2. Admin-only gate.
  const { session, error: authError } = await requireRole(["admin"]);
  if (authError) return authError;
  void session; // used for auth only; not needed below

  // 3. Parse and validate body.
  let body: {
    shoe_id?: string;
    size?: string;
    amount?: unknown;
    email?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!amount || amount <= 0 || !Number.isFinite(amount)) {
    return NextResponse.json(
      { error: "amount must be a positive number" },
      { status: 400 }
    );
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: "valid email is required" },
      { status: 400 }
    );
  }

  // 4. Initiate Chapa checkout.
  const result = await initChapa({
    shoeId: body.shoe_id ?? null,
    size: body.size ?? null,
    amount,
    email,
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    checkout_url: result.checkoutUrl,
    tx_ref: result.txRef,
  });
}
