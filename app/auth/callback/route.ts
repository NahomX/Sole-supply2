import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/";

  if (code) {
    const db = supabaseServer();
    await db.auth.exchangeCodeForSession(code);
  }

  // Resolve `next` against our origin and reject anything off-host. Without
  // this, `?next=//evil.com` or `?next=https://evil.com` would turn the
  // magic-link flow into an open redirect.
  const target = new URL(nextParam, url);
  const safe = target.origin === url.origin ? target : new URL("/", url);
  return NextResponse.redirect(safe);
}
