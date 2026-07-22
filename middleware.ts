import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import {
  LOGIN_AT_COOKIE,
  LAST_ACTIVITY_COOKIE,
  SESSION_COOKIE_OPTIONS,
  checkSessionTimeout,
} from "@/lib/session-timeout";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Refreshes the auth cookie on navigations AND enforces session timeouts.
//
// The actual role check still happens in Server Components / Route Handlers via
// requireRole(), because middleware can't easily hit the profiles table
// without another round-trip to Supabase for every navigation.
//
// Session timeout enforcement:
//   - After Supabase token refresh, checks `ss_login_at` (absolute lifetime)
//     and `ss_last_activity` (idle timeout) cookies.
//   - If either window is exceeded, signs the user out and redirects to
//     /auth/sign-in?session=expired.
//   - Otherwise, updates `ss_last_activity` to extend the idle window.
//   - Auth routes (/auth/*) are excluded from timeout checks to prevent
//     redirect loops.
export async function middleware(req: NextRequest) {
  // Guard: bail early if Supabase URL is missing or malformed (prevents 500s
  // when a global env var leaks a bad URL — see PR #36).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return NextResponse.next();
  try { new URL(url); } catch { return NextResponse.next(); }

  // Collect cookies into an array so we can apply them to whichever response
  // we end up returning (redirect or passthrough).
  const pendingCookies: CookieToSet[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (items: CookieToSet[]) => {
          pendingCookies.push(...items);
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // -------------------------------------------------------------------
  // Session timeout — skip for unauthenticated users and auth routes
  // (the latter prevents redirect loops during sign-in/callback/sign-out).
  // -------------------------------------------------------------------
  const pathname = req.nextUrl.pathname;
  if (user && !pathname.startsWith("/auth/")) {
    const loginAt = req.cookies.get(LOGIN_AT_COOKIE)?.value;
    const lastActivity = req.cookies.get(LAST_ACTIVITY_COOKIE)?.value;
    const { expired } = checkSessionTimeout(loginAt, lastActivity);

    if (expired) {
      // Sign out to revoke the refresh token server-side. If this fails
      // (network hiccup), we still clear cookies — the refresh token will
      // expire naturally.
      try {
        await supabase.auth.signOut();
      } catch {
        // Proceed with cookie clearing regardless.
      }

      const redirectUrl = new URL("/auth/sign-in?session=expired", req.url);
      const expiredRes = NextResponse.redirect(redirectUrl);

      // Apply any cookies from getUser() + signOut() (clears auth cookies).
      for (const { name, value, options } of pendingCookies) {
        expiredRes.cookies.set({ name, value, ...options });
      }

      // Clear our session-timeout cookies.
      expiredRes.cookies.set({
        name: LOGIN_AT_COOKIE,
        value: "",
        path: "/",
        maxAge: 0,
      });
      expiredRes.cookies.set({
        name: LAST_ACTIVITY_COOKIE,
        value: "",
        path: "/",
        maxAge: 0,
      });

      return expiredRes;
    }

    // Session still valid — update the idle-timeout clock.
    pendingCookies.push({
      name: LAST_ACTIVITY_COOKIE,
      value: String(Date.now()),
      options: SESSION_COOKIE_OPTIONS,
    });
  }

  // -------------------------------------------------------------------
  // Normal flow — apply all pending cookies to the passthrough response.
  // -------------------------------------------------------------------
  const res = NextResponse.next();
  for (const { name, value, options } of pendingCookies) {
    res.cookies.set({ name, value, ...options });
  }
  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)).*)",
  ],
};
