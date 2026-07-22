import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { LOGIN_AT_COOKIE, LAST_ACTIVITY_COOKIE } from "@/lib/session-timeout";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const db = supabaseServer();
  await db.auth.signOut();

  const res = NextResponse.redirect(new URL("/", req.url), { status: 303 });

  // Clear session-timeout cookies alongside the Supabase auth cookies.
  res.cookies.set({ name: LOGIN_AT_COOKIE, value: "", path: "/", maxAge: 0 });
  res.cookies.set({
    name: LAST_ACTIVITY_COOKIE,
    value: "",
    path: "/",
    maxAge: 0,
  });

  return res;
}
