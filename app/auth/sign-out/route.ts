import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const db = supabaseServer();
  await db.auth.signOut();
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
