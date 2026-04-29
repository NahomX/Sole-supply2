import { NextRequest, NextResponse } from "next/server";
import { supabaseService, type Role } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES: Role[] = ["admin", "submitter", "customer", "shipper"];

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { session, error: gate } = await requireRole(["admin"]);
  if (gate) return gate;

  const body = await req.json().catch(() => ({}));
  if (!ROLES.includes(body.role)) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  if (params.id === session?.userId && body.role !== "admin") {
    return NextResponse.json(
      { error: "you can't demote yourself" },
      { status: 400 }
    );
  }

  const db = supabaseService();
  const { data, error } = await db
    .from("profiles")
    .update({ role: body.role })
    .eq("id", params.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}
