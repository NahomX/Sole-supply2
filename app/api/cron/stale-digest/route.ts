import { NextRequest, NextResponse } from "next/server";
import { supabaseService, type Shoe } from "@/lib/supabase";
import { isStale, staleAgeDays } from "@/lib/staleness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/stale-digest
 *
 * Queries the shoes table, finds stale items (upcoming + no logistics + >7d
 * old), and sends a Telegram message if any are found.
 *
 * Security: guarded by CRON_SECRET. The caller must supply:
 *   Authorization: Bearer <CRON_SECRET>
 * Vercel Cron automatically injects this header when CRON_SECRET is set in
 * the project environment. The route also accepts ?secret=<CRON_SECRET> as
 * a fallback for manual triggers.
 *
 * Required env vars:
 *   CRON_SECRET          — shared secret (set in Vercel + vercel.json)
 *   TELEGRAM_BOT_TOKEN   — bot token from BotFather
 *   TELEGRAM_CHAT_ID     — destination chat / channel ID
 */
export async function GET(req: NextRequest) {
  // -----------------------------------------------------------------------
  // Auth check — reject unauthenticated callers.
  // -----------------------------------------------------------------------
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Misconfigured — fail closed.
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
  // Query shoes via the service-role client (bypasses RLS so we see all rows).
  // -----------------------------------------------------------------------
  const db = supabaseService();
  const { data, error } = await db
    .from("shoes")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const shoes = (data as Shoe[]) ?? [];
  const now = new Date();
  const stale = shoes.filter((s) => isStale(s, now));

  if (stale.length === 0) {
    return NextResponse.json({ ok: true, staleCount: 0, message: "no stale shoes" });
  }

  // -----------------------------------------------------------------------
  // Build and send Telegram digest.
  // -----------------------------------------------------------------------
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    // Env vars not set — log the stale list but don't fail silently.
    console.warn(
      `[stale-digest] ${stale.length} stale shoes found but TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID are not set`
    );
    return NextResponse.json({
      ok: false,
      staleCount: stale.length,
      warning: "Telegram env vars not configured — digest not sent",
    });
  }

  const lines = stale.map((s) => {
    const ageDays = staleAgeDays(s, now);
    return `• ${s.title} — ${ageDays}d old`;
  });

  const text =
    `[Sole Supply] ${stale.length} shoe${stale.length === 1 ? "" : "s"} need attention (upcoming + no logistics activity, >7 days old):\n\n` +
    lines.join("\n");

  const tgRes = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    }
  );

  if (!tgRes.ok) {
    const tgBody = await tgRes.text();
    console.error("[stale-digest] Telegram API error:", tgBody);
    return NextResponse.json(
      { error: "Telegram send failed", detail: tgBody },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, staleCount: stale.length });
}
