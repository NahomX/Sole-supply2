/**
 * card.ts — Just-in-time Issuing card detail retrieval.
 *
 * INVARIANTS (must NEVER be violated):
 *   1. PAN and CVC are fetched into memory-only variables; they are NEVER
 *      written to DB, disk, logs, or the LLM model context.
 *   2. After the browser submits the checkout form, both variables are zeroed
 *      (overwritten with empty string) and the CardSecrets object is frozen.
 *   3. The restricted key (rk_*) can ONLY read Issuing cards — it cannot
 *      provision, update, transfer, or raise limits.
 *   4. This module must NEVER be imported by the Next.js app (Vercel plane).
 *      It is worker-only.
 *
 * Implementation note: Stripe's Node SDK does not surface the raw PAN/CVC
 * through the standard `cards.retrieve` path on a restricted key in test mode.
 * In production you would use Stripe's `issuing.cards.retrieve` with the
 * `expand: ['number', 'cvc']` option (restricted key scoped to Issuing read).
 * For TEST mode scaffolding we use Stripe test card constants which are public
 * by design. The retrieval stub below is wired to swap in real API calls once
 * the Stripe account has Issuing enabled.
 */

import Stripe from "stripe";

/** Card details held only in memory, never persisted. */
export interface CardSecrets {
  /** Last-4 for logging (safe). PAN is full 16-digit card number. */
  last4: string;
  /** Full PAN — ephemeral, zeroed after use. */
  pan: string;
  /** Card verification code — ephemeral, zeroed after use. */
  cvc: string;
  /** Expiry month (1–12). */
  expMonth: number;
  /** Expiry year (4-digit). */
  expYear: number;
  /** Whether this is a live-mode card (guards against test/live mixup). */
  livemode: boolean;
}

/**
 * Retrieve Issuing card secrets just-in-time using the restricted Stripe key.
 *
 * The restricted key (`rk_*`) has Issuing-read permission only. Stripe returns
 * PAN + CVC only when explicitly expanded; the worker requests that expansion.
 *
 * After checkout the caller MUST call `zeroCardSecrets(secrets)` immediately.
 *
 * @param stripeCardId - The Stripe card ID (e.g. "ic_test_...") stored in issuing_cards.
 * @param restrictedKey - The rk_* key from env (NOT the full sk_* key).
 */
export async function retrieveCardSecrets(
  stripeCardId: string,
  restrictedKey: string
): Promise<CardSecrets> {
  if (!restrictedKey.startsWith("rk_")) {
    throw new Error(
      "card.ts: retrieveCardSecrets requires a restricted key (rk_*). " +
        "Full secret keys (sk_*) must not be used in the worker."
    );
  }

  const stripe = new Stripe(restrictedKey, {
    apiVersion: "2026-05-27.dahlia",
  });

  // Retrieve the card with PAN + CVC expanded.
  // In live mode this requires the restricted key to have
  // `issuing.cards.number_revealed` permission; in test mode, Stripe
  // returns test values for cards created in test mode.
  const card = await stripe.issuing.cards.retrieve(stripeCardId, {
    expand: ["number", "cvc"],
  });

  // Type cast: the expanded fields are typed as `string | null` in
  // the Stripe SDK but will be non-null when the restricted key has
  // the appropriate permission and the card is active.
  const pan = (card as unknown as { number?: string }).number;
  const cvc = (card as unknown as { cvc?: string }).cvc;

  if (!pan || !cvc) {
    throw new Error(
      `card.ts: Stripe did not return PAN/CVC for card ${stripeCardId}. ` +
        "Ensure the restricted key has Issuing card read permission " +
        "and the card is active."
    );
  }

  // Livemode guard: refuse to process live cards in a TEST-only build.
  // This constant is set at compile time; flip to true in a future Phase 4 build.
  const LIVEMODE_ALLOWED = false;
  if (card.livemode && !LIVEMODE_ALLOWED) {
    throw new Error(
      "card.ts: live-mode card detected but this worker is TEST-only. " +
        "Flip LIVEMODE_ALLOWED in card.ts as part of the Phase 4 live-mode PR."
    );
  }

  return {
    last4: card.last4,
    pan,
    cvc,
    expMonth: card.exp_month,
    expYear: card.exp_year,
    livemode: card.livemode,
  };
}

/**
 * Zero card secrets immediately after the checkout form is submitted.
 *
 * Call this unconditionally in a finally block after the browser.submitCheckout()
 * resolves (whether it succeeded or threw). The caller should discard any
 * reference to `secrets` after this call.
 */
export function zeroCardSecrets(secrets: CardSecrets): void {
  // Overwrite in place. JS strings are immutable so we can't truly zero them
  // at the memory level, but we clear the object fields so no further code
  // can accidentally read the values.
  (secrets as { pan: string }).pan = "";
  (secrets as { cvc: string }).cvc = "";
  Object.freeze(secrets);
}
