/**
 * lib/issuing.ts — Stripe Issuing governance layer (Phase 2, TEST mode).
 *
 * SERVER-ONLY. Uses STRIPE_SECRET_KEY (full key, sk_test_* in TEST mode).
 * Never import this from a "use client" component or browser-side code.
 *
 * Responsibilities:
 *   provisionCard()       — create a Stripe Issuing cardholder + virtual card
 *                           with L1 spending controls; persist to issuing_cards.
 *   freezeCard()          — set card status to 'inactive' on Stripe + DB.
 *   getRemainingHeadroom() — compute remaining daily + monthly spend from
 *                           spend_ledger (for the L2 headroom check).
 *
 * INVARIANTS:
 *   - PAN/CVC are NEVER stored, returned to callers, or logged.
 *     We store only stripe_card_id, stripe_cardholder_id, last4.
 *   - livemode is detected from the Stripe secret key prefix
 *     (sk_live_* → true; sk_test_* or rk_test_* → false).
 *   - L1 spending controls are always set on provisioning:
 *       per_authorization: $300 (30000 cents)
 *       daily:             $2,000 (200000 cents)
 *       monthly:           $5,000 (500000 cents)
 *       allowed_categories: ['shoe_stores'] (MCC 5661)
 */

import Stripe from "stripe";
import { supabaseService } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Internal: Stripe client singleton — lazy-initialized.
// ---------------------------------------------------------------------------

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  _stripe = new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
  return _stripe;
}

/**
 * Detect livemode from the Stripe secret key prefix.
 * sk_live_* → live; anything else (sk_test_*, rk_test_*) → test.
 */
function detectLivemode(): boolean {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return key.startsWith("sk_live_");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IssuingCard = {
  id: string;              // issuing_cards.id (our UUID)
  stripe_card_id: string;
  stripe_cardholder_id: string;
  last4: string;
  livemode: boolean;
  status: "active" | "inactive" | "canceled";
};

export type HeadroomResult = {
  dailyRemainingCents: number;
  monthlyRemainingCents: number;
};

// ---------------------------------------------------------------------------
// L1 spending controls — applied at card provisioning.
// These are Stripe-enforced backstops independent of our L2 webhook.
// ---------------------------------------------------------------------------

const DAILY_LIMIT_CENTS = 200_000;     // $2,000
const MONTHLY_LIMIT_CENTS = 500_000;   // $5,000
const PER_AUTH_LIMIT_CENTS = 30_000;   // $300

// MCC 5661 = shoe stores. This is the only category allowed.
// "shoe_stores" corresponds to MCC 5661. Type cast as string[] since
// the Stripe SDK's AllowedCategory union is very large and we just need the values.
const ALLOWED_CATEGORIES: string[] = ["shoe_stores"];

// ---------------------------------------------------------------------------
// provisionCard
// ---------------------------------------------------------------------------

export type ProvisionCardInput = {
  /** Display name for the Stripe cardholder (admin-facing only). */
  cardholderName: string;
  /** Email for the Stripe cardholder (required by Stripe). */
  email: string;
  /**
   * US billing address for the cardholder (required by Stripe Issuing).
   * Use the fixed forwarding address configured in the environment.
   */
  billingAddress: {
    line1: string;
    city: string;
    state: string;
    postal_code: string;
    country: string; // "US"
  };
};

export type ProvisionCardResult =
  | { card: IssuingCard; error: null }
  | { card: null; error: string };

/**
 * Provision a new Stripe Issuing virtual card.
 *
 * Steps:
 *   1. Create a Stripe cardholder (individual type, provided address).
 *   2. Create a virtual card on that cardholder with L1 spending controls.
 *   3. Persist the card identifiers (NOT PAN/CVC) to issuing_cards.
 *
 * The function detects livemode from the API key prefix and stores it on the row.
 */
export async function provisionCard(
  input: ProvisionCardInput
): Promise<ProvisionCardResult> {
  const stripe = getStripe();
  const livemode = detectLivemode();

  try {
    // Step 1 — Stripe cardholder
    const cardholder = await stripe.issuing.cardholders.create({
      name: input.cardholderName,
      email: input.email,
      type: "individual",
      billing: {
        address: {
          line1: input.billingAddress.line1,
          city: input.billingAddress.city,
          state: input.billingAddress.state,
          postal_code: input.billingAddress.postal_code,
          country: input.billingAddress.country,
        },
      },
    });

    // Step 2 — Virtual card with L1 spending controls
    const stripeCard = await stripe.issuing.cards.create({
      cardholder: cardholder.id,
      currency: "usd",
      type: "virtual",
      spending_controls: {
        spending_limits: [
          { amount: PER_AUTH_LIMIT_CENTS, interval: "per_authorization" },
          { amount: DAILY_LIMIT_CENTS, interval: "daily" },
          { amount: MONTHLY_LIMIT_CENTS, interval: "monthly" },
        ],
        // "shoe_stores" is a valid MCC category string. The Stripe SDK type
        // for allowed_categories is a large union; we cast via unknown.
        /* eslint-disable-next-line */
        allowed_categories: ALLOWED_CATEGORIES as unknown as [],
      },
    });

    // Step 3 — Persist to issuing_cards (PAN/CVC never stored)
    const db = supabaseService();
    const row = {
      stripe_card_id: stripeCard.id,
      stripe_cardholder_id: cardholder.id,
      last4: stripeCard.last4,
      livemode,
      status: "active" as const,
    };
    const { data, error } = await db
      .from("issuing_cards")
      .insert(row)
      .select()
      .single();

    if (error) {
      // Attempt to cancel the Stripe card if DB write fails (best-effort cleanup).
      await stripe.issuing.cards.update(stripeCard.id, { status: "canceled" }).catch(() => null);
      return { card: null, error: `DB error: ${error.message}` };
    }

    const card = data as IssuingCard;
    console.log(`[issuing] Provisioned card ${card.id} (last4=${card.last4}, livemode=${livemode})`);
    return { card, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[issuing] provisionCard failed:", msg);
    return { card: null, error: msg };
  }
}

// ---------------------------------------------------------------------------
// freezeCard
// ---------------------------------------------------------------------------

export type FreezeCardResult =
  | { ok: true; error: null }
  | { ok: false; error: string };

/**
 * Freeze (set to inactive) a card on both Stripe and in issuing_cards.
 * A frozen card will be declined by Stripe at L1 — use this if the card
 * is suspected of misuse or the kill-switch is engaged.
 */
export async function freezeCard(cardId: string): Promise<FreezeCardResult> {
  const stripe = getStripe();
  const db = supabaseService();

  try {
    // Fetch the stripe_card_id from our DB.
    const { data, error: fetchErr } = await db
      .from("issuing_cards")
      .select("stripe_card_id")
      .eq("id", cardId)
      .single();

    if (fetchErr || !data) {
      return { ok: false, error: fetchErr?.message ?? "Card not found" };
    }

    const stripeCardId = (data as { stripe_card_id: string }).stripe_card_id;

    // Freeze on Stripe.
    await stripe.issuing.cards.update(stripeCardId, { status: "inactive" });

    // Update our DB.
    const { error: updateErr } = await db
      .from("issuing_cards")
      .update({ status: "inactive" })
      .eq("id", cardId);

    if (updateErr) {
      return { ok: false, error: `Stripe frozen but DB update failed: ${updateErr.message}` };
    }

    console.log(`[issuing] Card ${cardId} frozen`);
    return { ok: true, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[issuing] freezeCard failed:", msg);
    return { ok: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// getRemainingHeadroom
// ---------------------------------------------------------------------------

/**
 * Compute the remaining daily and monthly spend headroom for a card.
 *
 * Reads reserved + settled rows from spend_ledger for today (UTC) and the
 * current calendar month. Voided rows are excluded.
 *
 * Returns remaining cents (may be negative if somehow over-spent — treat as 0).
 */
export async function getRemainingHeadroom(
  cardId: string
): Promise<HeadroomResult> {
  const db = supabaseService();
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Fetch all non-voided spend ledger rows for this card this month.
  const { data, error } = await db
    .from("spend_ledger")
    .select("amount_cents, created_at")
    .eq("card_id", cardId)
    .neq("status", "voided")
    .gte("created_at", monthStart.toISOString());

  if (error) {
    // Fail-safe: return 0 headroom so the L2 webhook declines on DB error.
    console.error("[issuing] getRemainingHeadroom DB error:", error.message);
    return { dailyRemainingCents: 0, monthlyRemainingCents: 0 };
  }

  const rows = (data as { amount_cents: number; created_at: string }[]) ?? [];

  let dailySpent = 0;
  let monthlySpent = 0;

  for (const row of rows) {
    const rowDate = new Date(row.created_at);
    monthlySpent += row.amount_cents;
    if (rowDate >= dayStart) {
      dailySpent += row.amount_cents;
    }
  }

  return {
    dailyRemainingCents: Math.max(0, DAILY_LIMIT_CENTS - dailySpent),
    monthlyRemainingCents: Math.max(0, MONTHLY_LIMIT_CENTS - monthlySpent),
  };
}
