import { NextRequest, NextResponse } from "next/server";
import { supabaseService, type Role } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES: Role[] = ["admin", "submitter", "customer", "shipper"];

export async function POST(req: NextRequest) {
  const { error: gate } = await requireRole(["admin"]);
  if (gate) return gate;

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const role: Role = ROLES.includes(body.role) ? body.role : "submitter";
  if (!email || !/.+@.+\..+/.test(email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }

  const redirectTo =
    (process.env.NEXT_PUBLIC_SITE_URL ?? "") + "/auth/callback?next=/";

  const admin = supabaseService().auth.admin;
  const { data, error } = await admin.inviteUserByEmail(email, {
    data: { role },
    redirectTo: redirectTo || undefined,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If the user already existed, ensure their profile role is updated too.
  if (data?.user?.id) {
    await supabaseService()
      .from("profiles")
      .upsert(
        { id: data.user.id, email, role },
        { onConflict: "id" }
      );
  }

  return NextResponse.json({ ok: true });
}
