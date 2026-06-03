import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase";
import type { ShoeStatus, LogisticsStatus } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";
import { STATUSES, LOGISTICS, setLogisticsStatus, setSalesStatus } from "@/lib/shoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Admins can change any field. Shippers are restricted to logistics_status.
  const { session, error: gateError } = await requireRole(["admin", "shipper"]);
  if (gateError) return gateError;
  const role = session?.profile?.role ?? "customer";
  const actorLabel = session?.email ?? undefined;
  const meta = { actorLabel, source: "web" };

  const body = await req.json().catch(() => ({}));

  // logistics_status change — delegate to shared helper (feeds included).
  if ("logistics_status" in body) {
    const v = body.logistics_status;
    if (v !== null && !(typeof v === "string" && LOGISTICS.includes(v as LogisticsStatus))) {
      return NextResponse.json(
        { error: "invalid logistics_status" },
        { status: 400 }
      );
    }
    const result = await setLogisticsStatus(params.id, v as LogisticsStatus | null, meta);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });

    // If the body only contained logistics_status, return now.
    if (role !== "admin" || Object.keys(body).every((k) => k === "logistics_status")) {
      return NextResponse.json({ shoe: result.shoe });
    }
  }

  // Admin-only fields (status + scalar fields).
  if (role === "admin") {
    // Sales status change — delegate to shared helper (feeds included).
    if ("status" in body) {
      if (!STATUSES.includes(body.status)) {
        return NextResponse.json({ error: "invalid status" }, { status: 400 });
      }
      const result = await setSalesStatus(params.id, body.status as ShoeStatus, meta);
      if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });

      // If only status (+ maybe logistics_status already handled above), return now.
      const remainingKeys = Object.keys(body).filter(
        (k) => k !== "status" && k !== "logistics_status"
      );
      if (remainingKeys.length === 0) {
        return NextResponse.json({ shoe: result.shoe });
      }
    }

    // Scalar field updates (price_usd, sizes, notes) — direct DB write, no feed.
    const patch: Record<string, unknown> = {};
    if (typeof body.price_usd === "number") patch.price_usd = body.price_usd;
    if (typeof body.sizes === "string") patch.sizes = body.sizes;
    if (typeof body.notes === "string") patch.notes = body.notes;

    if (Object.keys(patch).length === 0) {
      // Only status/logistics were in the body and already handled above.
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
    return NextResponse.json({ shoe: data });
  }

  return NextResponse.json({ error: "nothing to update" }, { status: 400 });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error: gateError } = await requireRole(["admin"]);
  if (gateError) return gateError;

  const db = supabaseService();
  const { error } = await db.from("shoes").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
