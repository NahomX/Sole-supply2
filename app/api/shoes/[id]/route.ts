import { NextRequest, NextResponse } from "next/server";
import {
  supabaseService,
  ShoeStatus,
  LogisticsStatus,
} from "@/lib/supabase";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: ShoeStatus[] = ["upcoming", "available", "sold"];
const LOGISTICS: LogisticsStatus[] = [
  "purchased",
  "dispatched",
  "arrived",
  "delivered",
];

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Admins can change any field. Logisters are restricted to logistics_status.
  const { session, error: gateError } = await requireRole(["admin", "shipper"]);
  if (gateError) return gateError;
  const role = session?.profile?.role ?? "customer";

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  // logistics_status: admin and shipper both allowed.
  // null is a valid value (unset / not yet started).
  if ("logistics_status" in body) {
    const v = body.logistics_status;
    if (v === null || (typeof v === "string" && LOGISTICS.includes(v as LogisticsStatus))) {
      patch.logistics_status = v;
    } else {
      return NextResponse.json(
        { error: "invalid logistics_status" },
        { status: 400 }
      );
    }
  }

  // Admin-only fields.
  if (role === "admin") {
    if (body.status && STATUSES.includes(body.status)) patch.status = body.status;
    if (typeof body.price_usd === "number") patch.price_usd = body.price_usd;
    if (typeof body.sizes === "string") patch.sizes = body.sizes;
    if (typeof body.notes === "string") patch.notes = body.notes;
  }

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
  return NextResponse.json({ shoe: data });
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
