import { NextRequest, NextResponse } from "next/server";
import { supabaseServer, ShoeStatus } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: ShoeStatus[] = ["upcoming", "available", "sold"];

function authed(req: NextRequest): boolean {
  const header = req.headers.get("x-admin-password") ?? "";
  const expected = process.env.ADMIN_PASSWORD ?? "";
  return expected.length > 0 && header === expected;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!authed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (body.status && STATUSES.includes(body.status)) patch.status = body.status;
  if (typeof body.price_usd === "number") patch.price_usd = body.price_usd;
  if (typeof body.sizes === "string") patch.sizes = body.sizes;
  if (typeof body.notes === "string") patch.notes = body.notes;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const db = supabaseServer();
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
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!authed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = supabaseServer();
  const { error } = await db.from("shoes").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
