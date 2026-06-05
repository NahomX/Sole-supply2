/**
 * tools.ts — Agent tool definitions.
 *
 * Provides two categories of tools:
 *
 * A) @stripe/agent-toolkit wrapper — MINIMAL Issuing-read action set.
 *    The restricted key (rk_*) physically prevents write operations.
 *    We wrap the toolkit and expose ONLY issuing.cards.retrieve.
 *    If @stripe/agent-toolkit cannot be constrained further, we use a thin
 *    custom wrapper (implemented here) instead of the full toolkit surface.
 *
 * B) App-local tools:
 *    - getInCartQueue()         — reads shoe_sizes WHERE logistics_status='in_cart'
 *    - createDraftPO()          — inserts a purchase_orders row with status='draft'
 *    - getRetailerProductState()— Playwright scrape (delegates to browser.ts)
 *
 * INVARIANTS:
 *   1. The worker can NEVER open/approve its own PO. `createDraftPO` only
 *      inserts status='draft'; the RLS policy on the worker key enforces
 *      WITH CHECK (status='draft') so any attempt to insert/update to
 *      'open' will be rejected by Postgres.
 *   2. PAN/CVC never appear in any tool parameter or return value.
 *   3. The restricted Stripe key provides no write capabilities.
 */

import Stripe from "stripe";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { tool } from "ai";
import { z } from "zod";
import { getRetailerProductState as browserGetState } from "./browser.js";
import type { RetailerProductState } from "./browser.js";

// ---------------------------------------------------------------------------
// Types mirroring the DB schema (subset used by worker).
// ---------------------------------------------------------------------------

export interface InCartItem {
  /** shoe_sizes.id */
  sizeId: string;
  /** shoe_sizes.us_size */
  usSize: string;
  /** shoes.id */
  shoeId: string;
  /** shoes.title */
  title: string;
  /** shoes.url — producer URL (admin-only; worker reads but must not expose to LLM in full) */
  retailerUrl: string;
  /** shoes.price_usd */
  priceUsd: number | null;
}

export interface DraftPOInput {
  /** issuing_cards.id (internal UUID, not stripe_card_id) */
  cardId: string;
  /** Array of shoe_sizes.id to purchase */
  sizeIds: string[];
  /** Retailer domain (e.g. "sandbox-checkout.example") */
  retailerDomain: string;
  /** Maximum authorization amount in cents (must be <= 30000) */
  maxAmountCents: number;
  /** Free-text reasoning from the agent (logged; not sent to LLM model context) */
  agentReason: string;
}

export interface DraftPOResult {
  purchaseOrderId: string;
  status: "draft";
}

// ---------------------------------------------------------------------------
// Supabase client (worker-scoped key).
// ---------------------------------------------------------------------------

let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_WORKER_KEY;
    if (!url || !key) {
      throw new Error(
        "tools.ts: SUPABASE_URL and SUPABASE_WORKER_KEY must be set in the worker environment."
      );
    }
    _supabase = createClient(url, key, { auth: { persistSession: false } });
  }
  return _supabase;
}

// ---------------------------------------------------------------------------
// A) Stripe Issuing — thin wrapper around the restricted key.
//
// @stripe/agent-toolkit exposes a broad surface. We do NOT import it directly
// here because we cannot constrain it to Issuing-read only within the toolkit
// config (it depends on which key is passed, but the toolkit itself may offer
// UI affordances to the LLM for write operations).
//
// Instead: we expose ONE Stripe action to the LLM — retrieveIssuingCard —
// which returns only the non-secret card metadata (last4, status, livemode).
// The full card secrets (PAN/CVC) are retrieved by card.ts OUTSIDE the LLM
// context and are never passed through the agent tool call chain.
// ---------------------------------------------------------------------------

export interface IssuingCardMetadata {
  stripeCardId: string;
  last4: string;
  status: string;
  livemode: boolean;
  expMonth: number;
  expYear: number;
}

export function makeStripeCardTool(restrictedKey: string) {
  if (!restrictedKey.startsWith("rk_")) {
    throw new Error(
      "tools.ts: Stripe card tool requires a restricted key (rk_*)."
    );
  }
  const stripe = new Stripe(restrictedKey, {
    apiVersion: "2026-05-27.dahlia",
  });

  return tool({
    description:
      "Retrieve public metadata for an Issuing card (last4, status, livemode). " +
      "Does NOT return PAN or CVC — those are handled by deterministic code only.",
    parameters: z.object({
      stripeCardId: z
        .string()
        .describe("The Stripe card ID (e.g. 'ic_test_...')"),
    }),
    execute: async ({ stripeCardId }): Promise<IssuingCardMetadata> => {
      // Only retrieve non-secret fields.
      const card = await stripe.issuing.cards.retrieve(stripeCardId);
      return {
        stripeCardId: card.id,
        last4: card.last4,
        status: card.status,
        livemode: card.livemode,
        expMonth: card.exp_month,
        expYear: card.exp_year,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// B) App-local tools.
// ---------------------------------------------------------------------------

/**
 * Read the in-cart buy queue: shoe_sizes rows WHERE logistics_status='in_cart'.
 * Joined with shoes for URL + price context.
 *
 * The worker scoped key has SELECT on shoe_sizes + shoes.
 */
export async function getInCartQueue(): Promise<InCartItem[]> {
  const { data, error } = await getSupabase()
    .from("shoe_sizes")
    .select(
      `
      id,
      us_size,
      shoe_id,
      shoes (
        id,
        title,
        url,
        price_usd
      )
    `
    )
    .eq("logistics_status", "in_cart");

  if (error) {
    throw new Error(`tools.ts getInCartQueue: ${error.message}`);
  }

  type RawRow = {
    id: string;
    us_size: string;
    shoe_id: string;
    // Supabase returns joined tables as arrays; we take the first element.
    shoes: Array<{
      id: string;
      title: string;
      url: string;
      price_usd: number | null;
    }> | null;
  };

  return (data as unknown as RawRow[] ?? []).map((row) => {
    const shoe = Array.isArray(row.shoes) ? row.shoes[0] : null;
    return {
      sizeId: row.id,
      usSize: row.us_size,
      shoeId: row.shoe_id,
      title: shoe?.title ?? "",
      retailerUrl: shoe?.url ?? "",
      priceUsd: shoe?.price_usd ?? null,
    };
  });
}

/**
 * Create a draft purchase order (status='draft').
 *
 * The worker's scoped Supabase key has INSERT on purchase_orders
 * WITH CHECK (status='draft') — the DB will reject any attempt to
 * insert status='open' or higher. This is the structural guarantee
 * that the worker can NEVER self-approve a PO.
 */
export async function createDraftPO(
  input: DraftPOInput
): Promise<DraftPOResult> {
  if (input.maxAmountCents > 30_000) {
    throw new Error(
      `tools.ts createDraftPO: maxAmountCents ${input.maxAmountCents} exceeds the $300 cap. ` +
        "The worker must never request more than $300 per authorization."
    );
  }

  const { data, error } = await getSupabase()
    .from("purchase_orders")
    .insert({
      card_id: input.cardId,
      size_ids: input.sizeIds,
      retailer_domain: input.retailerDomain,
      max_amount_cents: input.maxAmountCents,
      status: "draft", // RLS enforces this; any other value is rejected
      single_use: true,
      livemode: false, // Phase 3 = TEST mode only
    })
    .select("id, status")
    .single();

  if (error) {
    throw new Error(`tools.ts createDraftPO: ${error.message}`);
  }

  return {
    purchaseOrderId: data.id,
    status: "draft",
  };
}

/**
 * Poll the purchase_orders table for a PO status change.
 * Returns the current status of the PO.
 */
export async function getPOStatus(
  purchaseOrderId: string
): Promise<string> {
  const { data, error } = await getSupabase()
    .from("purchase_orders")
    .select("status, expires_at")
    .eq("id", purchaseOrderId)
    .single();

  if (error) {
    throw new Error(`tools.ts getPOStatus: ${error.message}`);
  }

  return data.status as string;
}

/**
 * getRetailerProductState tool — wraps browser.ts scrape.
 * Exposed as an AI SDK tool for the LLM to call.
 */
export function makeGetRetailerProductStateTool() {
  return tool({
    description:
      "Scrape the retailer product page to get current price, available sizes, and stock status. " +
      "Only works for sandbox/localhost URLs in Phase 3. Real retailer URLs require Phase 4 adapters.",
    parameters: z.object({
      url: z
        .string()
        .describe("The retailer product URL to inspect."),
    }),
    execute: async ({ url }): Promise<RetailerProductState> => {
      return browserGetState(url);
    },
  });
}

/**
 * getInCartQueue AI tool wrapper.
 */
export function makeGetInCartQueueTool() {
  return tool({
    description:
      "Read the buy queue: shoe_sizes rows where logistics_status='in_cart'. " +
      "Returns sizeId, usSize, shoeId, title, retailerUrl, priceUsd for each item.",
    parameters: z.object({}),
    execute: async (): Promise<InCartItem[]> => {
      return getInCartQueue();
    },
  });
}

/**
 * createDraftPO AI tool wrapper.
 */
export function makeCreateDraftPOTool() {
  return tool({
    description:
      "Create a draft Purchase Order for a set of shoe sizes. " +
      "The PO starts as 'draft' and requires human approval (via Telegram purchaser bot) " +
      "before any card spend can occur. The worker can NEVER approve its own PO.",
    parameters: z.object({
      cardId: z
        .string()
        .describe("Internal UUID of the issuing_cards row to charge."),
      sizeIds: z
        .array(z.string())
        .describe("Array of shoe_sizes.id values to purchase."),
      retailerDomain: z
        .string()
        .describe("Retailer domain, e.g. 'sandbox-checkout.example'."),
      maxAmountCents: z
        .number()
        .int()
        .min(1)
        .max(30_000)
        .describe(
          "Maximum authorization amount in cents. Must not exceed 30000 ($300)."
        ),
      agentReason: z
        .string()
        .max(500)
        .describe("Brief reason the agent chose these sizes (audit log only)."),
    }),
    execute: async (input: DraftPOInput): Promise<DraftPOResult> => {
      return createDraftPO(input);
    },
  });
}
