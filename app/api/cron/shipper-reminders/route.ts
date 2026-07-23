import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase";
import type { Shoe, ShoeSize } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Status mapping — one-line change if the owner later remaps the transition.
// ---------------------------------------------------------------------------
const REMINDER_FROM_STATUS = "purchased" as const;
const REMINDER_TO_STATUS = "arrived" as const;

/**
 * GET /api/cron/shipper-reminders
 *
 * Sends a recurring Telegram DM to every shipper with a summary of sizes at
 * REMINDER_FROM_STATUS ("purchased") — the backlog awaiting shipment to Addis.
 * Each DM includes an inline keyboard button that opens the standard arrive
 * flow so the shipper can confirm exactly which sizes were shipped.
 *
 * Security: guarded by CRON_SECRET (same model as stale-digest).
 *   Authorization: Bearer <CRON_SECRET>    — injected by Vercel Cron
 *   ?secret=<CRON_SECRET>                  — fallback for manual testing
 *
 * Required env vars:
 *   CRON_SECRET         — shared secret (set in Vercel + vercel.json)
 *   UNIFIED_BOT_TOKEN   — unified bot token (reminders are sent via the
 *                         unified bot so the confirm button's callback routes
 *                         back to its webhook handler)
 *
 * Telegram consent constraint: the bot can only DM users who have previously
 * sent it /start. If a shipper has not opened a conversation with the bot,
 * the Telegram API returns 403 ("bot can't initiate conversation with the
 * user"). This is caught, logged, and skipped — it never crashes the route.
 *
 * Note: this feature only produces meaningful reminders once migration 0005
 * (shoe_sizes table) is applied and shoes actually have sizes in the DB.
 */
export async function GET(req: NextRequest) {
  // -----------------------------------------------------------------------
  // Auth check — reject unauthenticated callers.
  // -----------------------------------------------------------------------
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron not configured" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const querySecret = req.nextUrl.searchParams.get("secret") ?? "";
  const provided = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : querySecret;

  if (provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // -----------------------------------------------------------------------
  // Env check — UNIFIED_BOT_TOKEN is required for sending DMs.
  // -----------------------------------------------------------------------
  const botToken = process.env.UNIFIED_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json(
      { error: "UNIFIED_BOT_TOKEN not configured" },
      { status: 500 }
    );
  }

  // -----------------------------------------------------------------------
  // Query purchased sizes (join shoes for title + soft-remove filter).
  // -----------------------------------------------------------------------
  const db = supabaseService();

  const { data: shoeData, error: shoeError } = await db
    .from("shoes")
    .select("id, title, shoe_sizes(*)")
    .is("removed_at", null)
    .order("created_at", { ascending: true });

  if (shoeError) {
    return NextResponse.json({ error: shoeError.message }, { status: 500 });
  }

  const shoes = (shoeData as (Pick<Shoe, "id" | "title"> & { shoe_sizes: ShoeSize[] })[]) ?? [];

  // Filter to shoes that have at least one size at REMINDER_FROM_STATUS.
  type PurchasedShoe = { title: string; sizes: { us_size: string; quantity: number }[] };
  const purchasedShoes: PurchasedShoe[] = [];
  let totalPairs = 0;

  for (const shoe of shoes) {
    const eligibleSizes = (shoe.shoe_sizes ?? []).filter(
      (sz) => sz.logistics_status === REMINDER_FROM_STATUS
    );
    if (eligibleSizes.length === 0) continue;

    const sizes = eligibleSizes.map((sz) => ({
      us_size: sz.us_size,
      quantity: sz.quantity ?? 1,
    }));
    const shoePairs = sizes.reduce((sum, s) => sum + s.quantity, 0);
    totalPairs += shoePairs;
    purchasedShoes.push({ title: shoe.title, sizes });
  }

  if (purchasedShoes.length === 0) {
    return NextResponse.json({
      ok: true,
      shippersNotified: 0,
      shippersSkipped: 0,
      totalPairs: 0,
      message: `no sizes at "${REMINDER_FROM_STATUS}"`,
    });
  }

  // -----------------------------------------------------------------------
  // Query shippers from telegram_users (role-based v1: remind ALL shippers).
  // Admins are also included since admin role satisfies shipper actions.
  // -----------------------------------------------------------------------
  const { data: shipperData, error: shipperError } = await db
    .from("telegram_users")
    .select("telegram_id, label, role")
    .in("role", ["shipper", "admin"]);

  if (shipperError) {
    return NextResponse.json({ error: shipperError.message }, { status: 500 });
  }

  const shippers = (shipperData as { telegram_id: number; label: string | null; role: string }[]) ?? [];

  if (shippers.length === 0) {
    return NextResponse.json({
      ok: true,
      shippersNotified: 0,
      shippersSkipped: 0,
      totalPairs,
      message: "no shippers in telegram_users",
    });
  }

  // -----------------------------------------------------------------------
  // Build the reminder message (shared across all shippers in v1).
  // -----------------------------------------------------------------------
  const text = formatReminderMessage(purchasedShoes, totalPairs);

  // Inline keyboard: one button that opens the arrive flow via the unified bot.
  // Callback data u_sr is handled by the unified-handler.
  const replyMarkup = {
    inline_keyboard: [
      [{ text: "✅ I've shipped these →", callback_data: "u_sr" }],
    ],
  };

  // -----------------------------------------------------------------------
  // Send DMs — catch per-shipper failures so one 403 doesn't kill the loop.
  // -----------------------------------------------------------------------
  let notified = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const shipper of shippers) {
    try {
      const ok = await sendTelegramMessage(
        botToken,
        shipper.telegram_id,
        text,
        undefined, // no parse_mode — plain text
        10_000,    // 10s timeout per DM
        replyMarkup
      );
      if (ok) {
        notified++;
      } else {
        // Telegram returned a non-2xx status (likely 403 — bot can't DM this user).
        // The shipper must send /start to the bot first.
        skipped++;
        const label = shipper.label ?? String(shipper.telegram_id);
        const detail = `shipper ${label}: send failed (likely needs /start)`;
        errors.push(detail);
        console.warn(`[shipper-reminders] ${detail}`);
      }
    } catch (err) {
      skipped++;
      const label = shipper.label ?? String(shipper.telegram_id);
      const msg = err instanceof Error ? err.message : "unknown error";
      const detail = `shipper ${label}: ${msg}`;
      errors.push(detail);
      console.error(`[shipper-reminders] ${detail}`);
    }
  }

  return NextResponse.json({
    ok: true,
    shippersNotified: notified,
    shippersSkipped: skipped,
    totalPairs,
    purchasedShoes: purchasedShoes.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}

// ---------------------------------------------------------------------------
// Pure helper: format the reminder message text.
// ---------------------------------------------------------------------------

/**
 * Format the shipping reminder message.
 *
 * Example output:
 *   Shipping reminder -- 6 pairs ready to send to Addis:
 *   - Air Jordan 1 Low -- US 9 (x2), US 9.5
 *   - Nike Dunk -- US 8 (x3)
 *   Tap below once you've shipped them.
 */
function formatReminderMessage(
  shoes: { title: string; sizes: { us_size: string; quantity: number }[] }[],
  totalPairs: number
): string {
  const header = `\u{1F4E6} Shipping reminder — ${totalPairs} pair${totalPairs === 1 ? "" : "s"} ready to send to Addis:`;

  const lines = shoes.map((shoe) => {
    const sizeLabels = shoe.sizes.map((s) =>
      s.quantity > 1 ? `US ${s.us_size} (×${s.quantity})` : `US ${s.us_size}`
    );
    return `• ${shoe.title.slice(0, 50)} — ${sizeLabels.join(", ")}`;
  });

  return `${header}\n${lines.join("\n")}\n\nTap below once you've shipped them.`;
}
