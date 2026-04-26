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
export function supabaseServer() {
  const store = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
