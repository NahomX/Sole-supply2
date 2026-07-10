import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Server client with the user's session (cookie-aware). Use in Server Components,
// Route Handlers, and middleware wrappers. Do NOT use for privileged writes —
// RLS still applies.
//
// Lives in its own file (separate from lib/supabase.ts) because importing
// next/headers anywhere in a module makes that module server-only, and
// lib/supabase.ts is also imported by client components (sign-in page).
// Lenient guard: logs a warning for a missing/malformed URL but does NOT throw.
// During `next build`, pre-rendered pages call supabaseServer() — a throw here
// breaks static generation when a global malformed SUPABASE_* env var exists on
// the build host (a known Windows-env gotcha). The Supabase client tolerates a
// bad URL at creation time and returns errors on queries, which the callers
// (e.g. getSessionInfo → returns null) already handle.
export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    console.warn("[supabase] NEXT_PUBLIC_SUPABASE_URL is not set — auth calls will fail.");
  } else {
    try { new URL(url); } catch {
      console.warn("[supabase] NEXT_PUBLIC_SUPABASE_URL is malformed:", url);
    }
  }
  const store = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (items: CookieToSet[]) => {
          try {
            items.forEach(({ name, value, options }) =>
              store.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — cookies are read-only. Safe to ignore.
          }
        },
      },
    }
  );
}
