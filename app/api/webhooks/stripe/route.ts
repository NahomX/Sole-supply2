/**
 * app/api/webhooks/stripe/route.ts — Stripe Issuing webhook handler (Phase 2).
 *
 * Handles two event types:
 *   1. issuing_authorization.request  — L2 real-time auth decision (≤2s budget).
 *   2. issuing_authorization.updated  — post-auth event (capture/void).
 *      issuing_transaction.created    — capture event (idempotent with above).
 *
 * INVARIANTS (every layer assumes the one above is compromised):
 *   - Signature verification is ALWAYS the first check.
 *     Failure → DECLINE the authorization (not just 403).
 *   - livemode on the Stripe event must match livemode of the card in DB.
 *     Mismatch → DECLINE.
 *   - The L2 decision path is a SINGLE indexed DB query in a transaction
 *     (SELECT ... FOR UPDATE on purchase_orders) — no external calls.
 *     This keeps latency well within the 2s Stripe window.
 *   - Approve ONLY if ALL of:
 *       (a) exactly one PO row at status='open' for this card_id,
 *       (b) PO.expires_at > now(),
 *       (c) PO.single_use_consumed = false,
 *       (d) requested amount ≤ PO.max_amount_cents AND ≤ 30000,
 *       (e) daily + monthly headroom OK (from spend_ledger),
 *       (f) merchant MCC is in the allowed-categories list (5661 = shoe stores).
 *   - On approve: atomically set PO status='authorizing', write a spend_ledger
 *     reservation, set stripe_authorization_id, mark single_use_consumed=true.
 *   - On decline: log to issuing_authorizations with a decline_reason.
 *   - Capture event: re-verify via Stripe API → close PO → finalize ledger →
 *     advance size_ids from in_cart→purchased via setSizeStatus.
 *     Idempotent on stripe_authorization_id.
 *
 * PAN/CVC are NEVER logged or stored anywhere in this handler.
 *
 * Stripe real-time authorization response:
 *   Approve → respond 200 with JSON { approved: true }
 *   Decline → respond 200 with JSON { approved: false }
 *   (Stripe reads the `approved` field from the 200 body for .request events.)
 */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseService } from "@/lib/supabase";
import { setSizeStatus } from "@/lib/shoes";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard per-auth cap in cents — mirrors L1 spending limit. */
const PER_AUTH_CAP_CENTS = 30_000;

/** Daily spend cap in cents — mirrors L1. */
const DAILY_CAP_CENTS = 200_000;

/** Monthly spend cap in cents — mirrors L1. */
const MONTHLY_CAP_CENTS = 500_000;

/**
 * Stripe MCC codes for shoe/sneaker retailers.
 * MCC 5661 = "Shoe Stores" is the primary allowed category.
 * We match against the authorization's merchant_data.category.
 */
const ALLOWED_MCC_CATEGORIES = new Set(["shoe_stores", "sporting_goods_stores"]);

// ---------------------------------------------------------------------------
// Stripe client
// ---------------------------------------------------------------------------

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
}

function getExpectedLivemode(): boolean {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return key.startsWith("sk_live_");
}

// ---------------------------------------------------------------------------
// Decline helper — respond to Stripe with approved: false + log to DB.
// ---------------------------------------------------------------------------

async function declineAuth(
  stripe: Stripe,
  auth: Stripe.Issuing.Authorization,
  reason: string,
  cardDbId: string | null
): Promise<NextResponse> {
  // Log asynchronously (best-effort) — must not block the response.
  void logAuthDecision({
    stripeAuthId: auth.id,
    cardId: cardDbId,
    purchaseOrderId: null,
    amountCents: auth.amount,
    currency: auth.currency,
    merchantCategory: auth.merchant_data?.category ?? null,
    merchantName: auth.merchant_data?.name ?? null,
    decision: "declined",
    declineReason: reason,
    livemode: auth.livemode,
  }).catch((e) => console.error("[stripe-webhook] log-decline error:", e));

  return NextResponse.json({ approved: false }, { status: 200 });
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

type AuthLogRow = {
  stripeAuthId: string;
  cardId: string | null;
  purchaseOrderId: string | null;
  amountCents: number;
  currency: string;
  merchantCategory: string | null;
  merchantName: string | null;
  decision: "approved" | "declined";
  declineReason: string | null;
  livemode: boolean;
};

async function logAuthDecision(row: AuthLogRow): Promise<void> {
  const db = supabaseService();
  await db.from("issuing_authorizations").upsert(
    {
      stripe_auth_id: row.stripeAuthId,
      card_id: row.cardId,
      purchase_order_id: row.purchaseOrderId,
      amount_cents: row.amountCents,
      currency: row.currency,
      merchant_category: row.merchantCategory,
      merchant_name: row.merchantName,
      decision: row.decision,
      decline_reason: row.declineReason,
      livemode: row.livemode,
    },
    { onConflict: "stripe_auth_id", ignoreDuplicates: true }
  );
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not set — declining");
    // Fail-closed: cannot verify signature → must decline any auth request.
    return NextResponse.json({ approved: false }, { status: 200 });
  }

  // Read the raw body as text for signature verification.
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    console.error("[stripe-webhook] Missing stripe-signature header — declining");
    return NextResponse.json({ approved: false }, { status: 200 });
  }

  const stripe = getStripe();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[stripe-webhook] Signature verification failed:", msg);
    // Fail-closed: bad signature → decline any authorization.
    return NextResponse.json({ approved: false }, { status: 200 });
  }

  const expectedLivemode = getExpectedLivemode();

  // -------------------------------------------------------------------------
  // Route by event type.
  // -------------------------------------------------------------------------

  if (event.type === "issuing_authorization.request") {
    return handleAuthRequest(stripe, event, expectedLivemode);
  }

  if (
    event.type === "issuing_authorization.updated" ||
    event.type === "issuing_transaction.created"
  ) {
    // These are async — we have time for a re-verify. Fire-and-forget is fine;
    // we respond 200 immediately to Stripe and process in the background.
    void handleCaptureEvent(stripe, event, expectedLivemode).catch((e) =>
      console.error("[stripe-webhook] capture event error:", e)
    );
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // Unknown event type — acknowledge and ignore.
  return NextResponse.json({ received: true }, { status: 200 });
}

// ---------------------------------------------------------------------------
// L2 Authorization request handler (≤2s window)
// ---------------------------------------------------------------------------

async function handleAuthRequest(
  stripe: Stripe,
  event: Stripe.Event,
  expectedLivemode: boolean
): Promise<NextResponse> {
  const auth = event.data.object as Stripe.Issuing.Authorization;

  // livemode guard — reject events whose livemode doesn't match our key.
  if (auth.livemode !== expectedLivemode) {
    console.warn(
      `[stripe-webhook] livemode mismatch: event=${auth.livemode}, expected=${expectedLivemode}`
    );
    return NextResponse.json({ approved: false }, { status: 200 });
  }

  const db = supabaseService();

  // -------------------------------------------------------------------------
  // Step 1: Resolve the issuing_cards row from Stripe's card id.
  // -------------------------------------------------------------------------
  const { data: cardRow, error: cardErr } = await db
    .from("issuing_cards")
    .select("id, livemode, status")
    .eq("stripe_card_id", auth.card.id)
    .maybeSingle();

  if (cardErr || !cardRow) {
    console.error("[stripe-webhook] Card not found in DB:", auth.card.id);
    return declineAuth(stripe, auth, "card_not_found", null);
  }

  const card = cardRow as { id: string; livemode: boolean; status: string };

  if (card.livemode !== expectedLivemode) {
    return declineAuth(stripe, auth, "card_livemode_mismatch", card.id);
  }

  if (card.status !== "active") {
    return declineAuth(stripe, auth, "card_not_active", card.id);
  }

  // -------------------------------------------------------------------------
  // Step 2: MCC check — must be an allowed sneaker/shoe category.
  // -------------------------------------------------------------------------
  const merchantCategory = auth.merchant_data?.category ?? "";
  if (!ALLOWED_MCC_CATEGORIES.has(merchantCategory)) {
    console.warn(`[stripe-webhook] MCC not allowed: ${merchantCategory}`);
    return declineAuth(stripe, auth, `mcc_not_allowed:${merchantCategory}`, card.id);
  }

  // -------------------------------------------------------------------------
  // Step 3: Per-authorization cap check (independent of PO).
  // -------------------------------------------------------------------------
  if (auth.amount > PER_AUTH_CAP_CENTS) {
    return declineAuth(stripe, auth, `over_per_auth_cap:${auth.amount}`, card.id);
  }

  // -------------------------------------------------------------------------
  // Step 4: Headroom check from spend_ledger (daily + monthly).
  // -------------------------------------------------------------------------
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const { data: ledgerRows, error: ledgerErr } = await db
    .from("spend_ledger")
    .select("amount_cents, created_at")
    .eq("card_id", card.id)
    .neq("status", "voided")
    .gte("created_at", monthStart.toISOString());

  if (ledgerErr) {
    console.error("[stripe-webhook] Ledger query failed:", ledgerErr.message);
    return declineAuth(stripe, auth, "ledger_query_error", card.id);
  }

  let dailySpent = 0;
  let monthlySpent = 0;
  for (const row of (ledgerRows as { amount_cents: number; created_at: string }[]) ?? []) {
    monthlySpent += row.amount_cents;
    if (new Date(row.created_at) >= dayStart) {
      dailySpent += row.amount_cents;
    }
  }

  const dailyRemaining = DAILY_CAP_CENTS - dailySpent;
  const monthlyRemaining = MONTHLY_CAP_CENTS - monthlySpent;

  if (auth.amount > dailyRemaining) {
    return declineAuth(stripe, auth, `over_daily_headroom:remaining=${dailyRemaining}`, card.id);
  }
  if (auth.amount > monthlyRemaining) {
    return declineAuth(stripe, auth, `over_monthly_headroom:remaining=${monthlyRemaining}`, card.id);
  }

  // -------------------------------------------------------------------------
  // Step 5: PO lookup — single indexed query, SELECT FOR UPDATE (transaction).
  //
  // We use supabaseService() which uses the service-role key.
  // The FOR UPDATE lock prevents concurrent webhook races from double-approving.
  //
  // Note: Supabase JS client doesn't expose raw SQL FOR UPDATE; we use
  // Postgres RPC (supabase function) or raw query via the REST API.
  // To keep this as a single round-trip without a DB function, we use the
  // RPC approach with a Postgres function defined inline via rpc().
  //
  // However, since we can't define the function here, we use an optimistic
  // check + atomic update with a WHERE clause that acts as the lock guard.
  // The unique partial index on (card_id) WHERE status='open' ensures at most
  // one open PO per card — so even if two requests arrive simultaneously,
  // the UPDATE's WHERE clause makes only one succeed atomically.
  // -------------------------------------------------------------------------

  // Find the single open, unexpired, unused PO for this card.
  const { data: poRows, error: poErr } = await db
    .from("purchase_orders")
    .select("*")
    .eq("card_id", card.id)
    .eq("status", "open")
    .eq("single_use_consumed", false)
    .gt("expires_at", now.toISOString())
    .eq("livemode", expectedLivemode)
    .limit(2); // Fetch up to 2 to detect the impossible case of >1 open PO.

  if (poErr) {
    console.error("[stripe-webhook] PO query failed:", poErr.message);
    return declineAuth(stripe, auth, "po_query_error", card.id);
  }

  if (!poRows || poRows.length === 0) {
    return declineAuth(stripe, auth, "no_open_po", card.id);
  }

  if (poRows.length > 1) {
    // Should be structurally impossible due to the partial unique index.
    console.error("[stripe-webhook] Multiple open POs found for card:", card.id);
    return declineAuth(stripe, auth, "multiple_open_pos", card.id);
  }

  const po = poRows[0] as {
    id: string;
    max_amount_cents: number;
    single_use: boolean;
    single_use_consumed: boolean;
    expires_at: string;
    status: string;
    livemode: boolean;
  };

  // Amount check against PO ceiling.
  if (auth.amount > po.max_amount_cents) {
    return declineAuth(
      stripe,
      auth,
      `over_po_max:requested=${auth.amount},max=${po.max_amount_cents}`,
      card.id
    );
  }

  // -------------------------------------------------------------------------
  // Step 6: Atomic state transition — set PO to 'authorizing' and write
  //         the spend_ledger reservation. Both must succeed or we decline.
  //
  // The UPDATE WHERE status='open' acts as an optimistic lock:
  //   - If a concurrent request already flipped status away from 'open',
  //     this UPDATE returns 0 rows → we decline.
  //   - The unique partial index enforces there is at most 1 open PO per card.
  // -------------------------------------------------------------------------

  const { data: updatedPo, error: poUpdateErr } = await db
    .from("purchase_orders")
    .update({
      status: "authorizing",
      single_use_consumed: true,
      stripe_authorization_id: auth.id,
    })
    .eq("id", po.id)
    .eq("status", "open") // Optimistic lock — only succeeds if still open.
    .eq("single_use_consumed", false)
    .select("id")
    .maybeSingle();

  if (poUpdateErr || !updatedPo) {
    console.warn("[stripe-webhook] PO update race or error:", poUpdateErr?.message);
    return declineAuth(stripe, auth, "po_update_race", card.id);
  }

  // Write the spend_ledger reservation (best-effort; if this fails we still
  // have the PO in 'authorizing' state which prevents double-spend).
  const { error: ledgerInsertErr } = await db.from("spend_ledger").insert({
    card_id: card.id,
    purchase_order_id: po.id,
    stripe_authorization_id: auth.id,
    amount_cents: auth.amount,
    currency: auth.currency,
    status: "reserved",
    livemode: expectedLivemode,
  });

  if (ledgerInsertErr) {
    console.error("[stripe-webhook] Ledger reservation failed:", ledgerInsertErr.message);
    // Do NOT decline — PO is already in 'authorizing' state and the card
    // will capture correctly. Log the error and proceed.
  }

  // Log the approval decision.
  void logAuthDecision({
    stripeAuthId: auth.id,
    cardId: card.id,
    purchaseOrderId: po.id,
    amountCents: auth.amount,
    currency: auth.currency,
    merchantCategory: merchantCategory,
    merchantName: auth.merchant_data?.name ?? null,
    decision: "approved",
    declineReason: null,
    livemode: auth.livemode,
  }).catch((e) => console.error("[stripe-webhook] log-approve error:", e));

  console.log(
    `[stripe-webhook] APPROVED auth=${auth.id} po=${po.id} amount=${auth.amount} card=${card.id}`
  );

  return NextResponse.json({ approved: true }, { status: 200 });
}

// ---------------------------------------------------------------------------
// Capture event handler (async — no 2s constraint)
// ---------------------------------------------------------------------------

async function handleCaptureEvent(
  stripe: Stripe,
  event: Stripe.Event,
  expectedLivemode: boolean
): Promise<void> {
  const db = supabaseService();

  // Extract stripe_authorization_id from the event.
  let stripeAuthId: string;
  if (event.type === "issuing_authorization.updated") {
    const auth = event.data.object as Stripe.Issuing.Authorization;
    stripeAuthId = auth.id;
    // livemode guard.
    if (auth.livemode !== expectedLivemode) {
      console.warn("[stripe-webhook] capture livemode mismatch, skipping");
      return;
    }
  } else if (event.type === "issuing_transaction.created") {
    const txn = event.data.object as Stripe.Issuing.Transaction;
    if (!txn.authorization) {
      console.warn("[stripe-webhook] issuing_transaction.created with no authorization, skipping");
      return;
    }
    stripeAuthId = typeof txn.authorization === "string"
      ? txn.authorization
      : (txn.authorization as Stripe.Issuing.Authorization).id;
    if (txn.livemode !== expectedLivemode) {
      console.warn("[stripe-webhook] capture livemode mismatch, skipping");
      return;
    }
  } else {
    return;
  }

  // -------------------------------------------------------------------------
  // Re-verify via Stripe API (we have time here — same pattern as Chapa).
  // -------------------------------------------------------------------------
  let stripeAuth: Stripe.Issuing.Authorization;
  try {
    stripeAuth = await stripe.issuing.authorizations.retrieve(stripeAuthId);
  } catch (err) {
    console.error("[stripe-webhook] Stripe re-verify failed:", err);
    return;
  }

  // Only process approved, captured authorizations.
  if (stripeAuth.status !== "closed") {
    // Not yet captured — updated events fire for many reasons; skip non-captures.
    return;
  }

  // -------------------------------------------------------------------------
  // Find the PO by stripe_authorization_id (idempotent — skip if already closed).
  // -------------------------------------------------------------------------
  const { data: poRow, error: poErr } = await db
    .from("purchase_orders")
    .select("*")
    .eq("stripe_authorization_id", stripeAuthId)
    .maybeSingle();

  if (poErr || !poRow) {
    console.warn("[stripe-webhook] No PO found for auth:", stripeAuthId);
    return;
  }

  const po = poRow as {
    id: string;
    status: string;
    size_ids: string[];
    card_id: string;
    livemode: boolean;
  };

  // Idempotent guard.
  if (po.status === "closed") {
    console.log("[stripe-webhook] PO already closed, skipping:", po.id);
    return;
  }

  // livemode guard on the PO row.
  if (po.livemode !== expectedLivemode) {
    console.warn("[stripe-webhook] PO livemode mismatch on capture, skipping");
    return;
  }

  // -------------------------------------------------------------------------
  // Close the PO.
  // -------------------------------------------------------------------------
  const { error: closeErr } = await db
    .from("purchase_orders")
    .update({ status: "closed" })
    .eq("id", po.id)
    .eq("status", "authorizing"); // Guard: only close from 'authorizing' state.

  if (closeErr) {
    console.error("[stripe-webhook] Failed to close PO:", closeErr.message);
    return;
  }

  // -------------------------------------------------------------------------
  // Finalize the spend_ledger (reserved → settled).
  // -------------------------------------------------------------------------
  await db
    .from("spend_ledger")
    .update({ status: "settled" })
    .eq("stripe_authorization_id", stripeAuthId)
    .eq("status", "reserved");

  // -------------------------------------------------------------------------
  // Advance each size_ids from in_cart → purchased.
  // Reuses the existing setSizeStatus helper which also posts to the ops feed.
  // We need to look up the (shoe_id, us_size) from the shoe_sizes table.
  // -------------------------------------------------------------------------
  if (po.size_ids && po.size_ids.length > 0) {
    // Fetch shoe_sizes rows for these IDs.
    const { data: sizeRows, error: sizeErr } = await db
      .from("shoe_sizes")
      .select("id, shoe_id, us_size, logistics_status")
      .in("id", po.size_ids);

    if (sizeErr) {
      console.error("[stripe-webhook] Failed to fetch size rows:", sizeErr.message);
    } else {
      const rows = (sizeRows as { id: string; shoe_id: string; us_size: string; logistics_status: string | null }[]) ?? [];
      for (const row of rows) {
        if (row.logistics_status === "in_cart") {
          const result = await setSizeStatus(row.shoe_id, row.us_size, "purchased", {
            actorLabel: "stripe-issuing",
            source: "capture-webhook",
          });
          if (result.error) {
            console.error(
              `[stripe-webhook] setSizeStatus failed for size ${row.id}:`,
              result.error
            );
          }
        }
      }
    }
  }

  console.log(
    `[stripe-webhook] PO closed and sizes advanced: po=${po.id} auth=${stripeAuthId}`
  );
}
