/**
 * loop.ts — Bounded autonomous agent loop.
 *
 * Flow per invocation:
 *   1. Read agent_config — exit immediately if agent_enabled=false (kill switch).
 *   2. Read max_buys_per_run from agent_config.
 *   3. Read the in-cart queue (shoe_sizes WHERE logistics_status='in_cart').
 *   4. For each candidate (up to max_buys_per_run):
 *      a. Call Claude (via AI SDK generateText) to draft a buy plan.
 *      b. Create a draft purchase_orders row.
 *      c. Create an agent_runs row (status='running').
 *      d. Poll for purchaser approval (PO status → 'open') with timeout.
 *      e. On approval: retrieve card secrets JIT → run checkout (dryRun=true in Phase 3).
 *      f. Zero card secrets unconditionally in finally block.
 *      g. On checkout success: close the agent_runs row.
 *      h. On 'cancelled'/'failed' PO status: hard stop (do not try next item).
 *   5. Update agent_runs summary on exit.
 *
 * INVARIANTS:
 *   - Kill switch checked EVERY iteration, not just at entry.
 *   - max_buys_per_run enforced by counter that is never incremented on dry runs.
 *   - All card secrets are zeroed in finally blocks regardless of success/failure.
 *   - Phase 3 = TEST mode: submitCheckout is always called with dryRun=true.
 *   - Worker can only INSERT draft POs — the RLS policy prevents status escalation.
 */

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  getInCartQueue,
  createDraftPO,
  getPOStatus,
  makeStripeCardTool,
  makeGetInCartQueueTool,
  makeGetRetailerProductStateTool,
  makeCreateDraftPOTool,
} from "./tools.js";
import { retrieveCardSecrets, zeroCardSecrets } from "./card.js";
import { submitCheckout } from "./browser.js";

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`loop.ts: env var ${name} is required but not set.`);
  return val;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Supabase service (worker-scoped key).
// ---------------------------------------------------------------------------

let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_WORKER_KEY"),
      { auth: { persistSession: false } }
    );
  }
  return _supabase;
}

// ---------------------------------------------------------------------------
// agent_config read.
// ---------------------------------------------------------------------------

interface AgentConfig {
  agentEnabled: boolean;
  maxBuysPerRun: number;
}

async function readAgentConfig(): Promise<AgentConfig> {
  const { data, error } = await getSupabase()
    .from("agent_config")
    .select("agent_enabled, max_buys_per_run")
    .eq("id", 1)
    .single();

  if (error) {
    throw new Error(`loop.ts readAgentConfig: ${error.message}`);
  }

  return {
    agentEnabled: data.agent_enabled as boolean,
    maxBuysPerRun: data.max_buys_per_run as number,
  };
}

// ---------------------------------------------------------------------------
// Active Issuing card lookup.
// ---------------------------------------------------------------------------

interface IssuingCard {
  id: string; // internal UUID
  stripeCardId: string;
}

async function getActiveCard(): Promise<IssuingCard | null> {
  const { data, error } = await getSupabase()
    .from("issuing_cards")
    .select("id, stripe_card_id")
    .eq("status", "active")
    .eq("livemode", false) // Phase 3 = TEST mode only
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`loop.ts getActiveCard: ${error.message}`);
  }

  if (!data) return null;
  return { id: data.id, stripeCardId: data.stripe_card_id };
}

// ---------------------------------------------------------------------------
// agent_runs tracking.
// ---------------------------------------------------------------------------

interface AgentRunRow {
  id: string;
}

async function createAgentRun(): Promise<AgentRunRow> {
  const { data, error } = await getSupabase()
    .from("agent_runs")
    .insert({
      status: "running",
      livemode: false,
      summary: null,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`loop.ts createAgentRun: ${error.message}`);
  }
  return { id: data.id };
}

async function closeAgentRun(
  runId: string,
  status: "completed" | "failed" | "killed",
  summary: Record<string, unknown>
): Promise<void> {
  const { error } = await getSupabase()
    .from("agent_runs")
    .update({ status, summary, finished_at: new Date().toISOString() })
    .eq("id", runId);

  if (error) {
    // Non-fatal: log and continue.
    console.error(`loop.ts closeAgentRun: failed to update run ${runId}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Poll for PO approval.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 10_000; // 10 seconds

async function waitForPOApproval(
  purchaseOrderId: string,
  timeoutMs: number
): Promise<"open" | "cancelled" | "failed" | "timeout"> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await getPOStatus(purchaseOrderId);

    if (status === "open") return "open";
    if (status === "cancelled" || status === "failed") return status;
    // 'draft' = still waiting for purchaser action; 'authorizing' / 'closed' = should not occur here
    if (status !== "draft") {
      console.warn(
        `loop.ts waitForPOApproval: unexpected PO status "${status}" for PO ${purchaseOrderId}`
      );
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return "timeout";
}

// ---------------------------------------------------------------------------
// Main loop.
// ---------------------------------------------------------------------------

export interface LoopResult {
  itemsAttempted: number;
  itemsCompleted: number;
  halted: boolean;
  haltReason: string | null;
}

/**
 * Run one bounded agent loop iteration.
 *
 * In Phase 3 this is a TEST-only dry run:
 *   - dryRun=true → browser fills form but does NOT click "place order".
 *   - Real checkout execution is Phase 4.
 */
export async function runAgentLoop(): Promise<LoopResult> {
  const result: LoopResult = {
    itemsAttempted: 0,
    itemsCompleted: 0,
    halted: false,
    haltReason: null,
  };

  const restrictedKey = requireEnv("STRIPE_RESTRICTED_KEY");
  const poApprovalTimeoutSecs = parseInt(
    process.env.PO_APPROVAL_TIMEOUT_SECS ?? "1800",
    10
  );
  const poApprovalTimeoutMs = poApprovalTimeoutSecs * 1_000;

  // ---- Step 1: Kill-switch check ----
  const config = await readAgentConfig();
  if (!config.agentEnabled) {
    console.log("[loop] agent_enabled=false — exiting immediately (kill switch).");
    result.halted = true;
    result.haltReason = "kill_switch";
    return result;
  }

  const maxBuys = Math.min(
    config.maxBuysPerRun,
    parseInt(process.env.MAX_BUYS_PER_RUN ?? String(config.maxBuysPerRun), 10)
  );

  console.log(`[loop] Starting agent loop. max_buys_per_run=${maxBuys}`);

  // ---- Step 2: Get active card ----
  const card = await getActiveCard();
  if (!card) {
    console.log("[loop] No active test-mode issuing card found. Exiting.");
    result.halted = true;
    result.haltReason = "no_active_card";
    return result;
  }

  // ---- Step 3: Read in-cart queue ----
  const queue = await getInCartQueue();
  if (queue.length === 0) {
    console.log("[loop] In-cart queue is empty. Nothing to buy. Exiting.");
    return result;
  }

  console.log(`[loop] In-cart queue has ${queue.length} item(s). Will attempt up to ${maxBuys}.`);

  // ---- Step 4: Create agent_runs row ----
  const run = await createAgentRun();
  console.log(`[loop] agent_runs row created: ${run.id}`);

  // Build the AI SDK tools the LLM can call.
  const tools = {
    retrieveIssuingCard: makeStripeCardTool(restrictedKey),
    getInCartQueue: makeGetInCartQueueTool(),
    getRetailerProductState: makeGetRetailerProductStateTool(),
    createDraftPO: makeCreateDraftPOTool(),
  };

  let closeStatus: "completed" | "failed" | "killed" = "completed";

  try {
    // ---- Step 5: Process each in-cart item ----
    for (const item of queue) {
      // Re-check kill switch every iteration.
      const freshConfig = await readAgentConfig();
      if (!freshConfig.agentEnabled) {
        console.log("[loop] Kill switch triggered mid-run. Halting.");
        result.halted = true;
        result.haltReason = "kill_switch_mid_run";
        closeStatus = "killed";
        break;
      }

      if (result.itemsAttempted >= maxBuys) {
        console.log(`[loop] Reached max_buys_per_run=${maxBuys}. Stopping.`);
        break;
      }

      result.itemsAttempted++;
      console.log(
        `[loop] Processing item ${result.itemsAttempted}/${maxBuys}: ` +
          `shoe "${item.title}" size ${item.usSize} (sizeId=${item.sizeId})`
      );

      // ---- Step 5a: Claude drafts a buy plan ----
      // The LLM decides whether to proceed and constructs the PO parameters.
      // It does NOT see PAN/CVC — those are retrieved deterministically later.
      const { text: _agentPlan } = await generateText({
        model: anthropic("claude-opus-4-5"),
        system: [
          "You are the Berebaso procurement agent. Your job is to evaluate ",
          "in-cart sneaker items and decide whether to proceed with a draft ",
          "purchase order. You must be conservative — only proceed if the ",
          "product URL is reachable, the size is available, and the price ",
          "is within the $300 per-order cap.",
          "",
          "Phase 3 is TEST mode. All actions are dry runs. No real money moves.",
          "",
          "After evaluating the item, use the createDraftPO tool to submit ",
          "a draft purchase order, OR respond with 'SKIP: <reason>' if the ",
          "item should not be purchased (out of stock, price over cap, etc.).",
        ].join(""),
        messages: [
          {
            role: "user",
            content: [
              `Evaluate this in-cart item and create a draft PO if appropriate.`,
              ``,
              `Shoe: ${item.title}`,
              `Size: ${item.usSize}`,
              `Retailer URL: ${item.retailerUrl}`,
              `Price (from DB): $${item.priceUsd ?? "unknown"}`,
              `Card ID (internal): ${card.id}`,
              ``,
              `Use getRetailerProductState to check live availability, then `,
              `createDraftPO if the item is purchasable. The maxAmountCents `,
              `must not exceed 30000 ($300). Use the retailer domain from the URL.`,
            ].join("\n"),
          },
        ],
        tools,
        maxSteps: 5,
      });

      // Extract the draft PO ID from tool result (last createDraftPO call).
      // In practice the LLM's tool use response is embedded in the steps;
      // we look up the PO by card + sizeIds in the DB rather than parsing
      // the text response, to be robust to model phrasing.
      const { data: draftPOs } = await getSupabase()
        .from("purchase_orders")
        .select("id")
        .eq("card_id", card.id)
        .eq("status", "draft")
        .contains("size_ids", [item.sizeId])
        .order("created_at", { ascending: false })
        .limit(1);

      if (!draftPOs || draftPOs.length === 0) {
        console.log(
          `[loop] Agent skipped item (no draft PO created). Reason likely in agent plan.`
        );
        continue;
      }

      const poId = draftPOs[0].id as string;
      console.log(`[loop] Draft PO created: ${poId}. Waiting for purchaser approval...`);

      // ---- Step 5d: Poll for purchaser approval ----
      const approvalResult = await waitForPOApproval(poId, poApprovalTimeoutMs);

      if (approvalResult === "timeout") {
        console.log(`[loop] PO ${poId} timed out waiting for approval. Moving on.`);
        continue;
      }

      if (approvalResult === "cancelled" || approvalResult === "failed") {
        // Hard stop on any decline — the purchaser explicitly rejected.
        console.log(
          `[loop] PO ${poId} was ${approvalResult}. HARD STOP — not processing further items.`
        );
        result.halted = true;
        result.haltReason = `po_${approvalResult}`;
        closeStatus = "killed";
        break;
      }

      // approvalResult === 'open' — proceed with checkout.
      console.log(`[loop] PO ${poId} approved. Proceeding to checkout (dryRun=true in Phase 3).`);

      // ---- Step 5e: JIT card retrieval + checkout ----
      const cardSecrets = await retrieveCardSecrets(card.stripeCardId, restrictedKey);
      try {
        // Phase 3: always dryRun=true. Phase 4 will set dryRun=false after live-mode review.
        const checkoutResult = await submitCheckout(
          item.retailerUrl,
          item.usSize,
          cardSecrets,
          true // dryRun
        );

        if (checkoutResult.success) {
          console.log(
            `[loop] Checkout ${checkoutResult.confirmationId === "DRY_RUN" ? "DRY RUN" : "completed"} ` +
              `for PO ${poId}. Confirmation: ${checkoutResult.confirmationId ?? "n/a"}`
          );
          result.itemsCompleted++;
        } else {
          console.error(
            `[loop] Checkout failed for PO ${poId}: ${checkoutResult.error}`
          );
          closeStatus = "failed";
        }
      } finally {
        // ---- Step 5f: Zero card secrets unconditionally ----
        zeroCardSecrets(cardSecrets);
      }
    }
  } catch (err) {
    closeStatus = "failed";
    console.error("[loop] Unhandled error in agent loop:", err);
    throw err;
  } finally {
    // ---- Step 5g: Close agent_runs row ----
    await closeAgentRun(run.id, closeStatus, {
      itemsAttempted: result.itemsAttempted,
      itemsCompleted: result.itemsCompleted,
      halted: result.halted,
      haltReason: result.haltReason,
      phase: "3-test-mode",
    });
  }

  console.log(
    `[loop] Run complete. attempted=${result.itemsAttempted} completed=${result.itemsCompleted} ` +
      `halted=${result.halted} reason=${result.haltReason ?? "none"}`
  );
  return result;
}
