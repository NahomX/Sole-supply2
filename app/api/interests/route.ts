import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { getSessionInfo } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionInfo();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const shoeId = typeof body.shoe_id === "string" ? body.shoe_id : "";
  if (!shoeId) {
    return NextResponse.json({ error: "missing shoe_id" }, { status: 400 });
  }

  // Insert through the user's session so RLS "auth.uid() = user_id" passes.
  const db = supabaseServer();
  const { data, error } = await db
    .from("interests")
    .upsert(
      {
        shoe_id: shoeId,
        user_id: session.userId,
        size: typeof body.size === "string" ? body.size : null,
        notes: typeof body.notes === "string" ? body.notes : null,
      },
      { onConflict: "shoe_id,user_id" }
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ interest: data });
}

export async function DELETE(req: NextRequest) {
  const session = await getSessionInfo();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const shoeId = url.searchParams.get("shoe_id");
  if (!shoeId) {
    return NextResponse.json({ error: "missing shoe_id" }, { status: 400 });
  }
  const db = supabaseServer();
  const { error } = await db
    .from("interests")
    .delete()
    .eq("shoe_id", shoeId)
    .eq("user_id", session.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
