import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase";
import type { ShoeStatus } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";
import { STATUSES, setSalesStatus, syncSizesFromText } from "@/lib/shoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Admins can change any field. Shippers only use /api/shoes/[id]/sizes.
  const { session, error: gateError } = await requireRole(["admin"]);
  if (gateError) return gateError;
  const actorLabel = session?.email ?? undefined;
  const meta = { actorLabel, source: "web" };

  const body = await req.json().catch(() => ({}));

  // Per-shoe logistics_status no longer exists (dropped in 0005). Reject any
  // attempt to set it here — use /api/shoes/[id]/sizes instead.
  if ("logistics_status" in body) {
    return NextResponse.json(
      {
        error:
          "logistics_status is now per-size. Use PATCH /api/shoes/{id}/sizes/{usSize} instead.",
      },
      { status: 400 }
    );
  }

  // Sales status change — delegate to shared helper (feeds included).
  if ("status" in body) {
    if (!STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    const result = await setSalesStatus(params.id, body.status as ShoeStatus, meta);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });

    // If only status was in the body, return now.
    const remainingKeys = Object.keys(body).filter((k) => k !== "status");
    if (remainingKeys.length === 0) {
      return NextResponse.json({ shoe: result.shoe });
    }
  }

  // Scalar field updates (price_usd, sizes, notes) — direct DB write.
  // If sizes is updated, also sync shoe_sizes rows.
  const patch: Record<string, unknown> = {};
  if (typeof body.price_usd === "number") patch.price_usd = body.price_usd;
  if (typeof body.sizes === "string") patch.sizes = body.sizes;
  if (typeof body.notes === "string") patch.notes = body.notes;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const db = supabaseService();
  const { data, error } = await db
    .from("shoes")
    .update(patch)
    .eq("id", params.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // When sizes text changes, sync shoe_sizes rows to match.
  // New sizes get null logistics_status; removed sizes are deleted.
  if (typeof body.sizes === "string") {
    const { error: syncErr } = await syncSizesFromText(params.id, body.sizes);
    if (syncErr) {
      console.error("[sizes-sync] failed:", syncErr);
      // Non-fatal — the shoe row was updated; log and continue.
    }
  }

  return NextResponse.json({ shoe: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error: gateError } = await requireRole(["admin"]);
  if (gateError) return gateError;

  const db = supabaseService();
  // shoe_sizes rows are deleted via ON DELETE CASCADE on the FK.
  const { error } = await db.from("shoes").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
