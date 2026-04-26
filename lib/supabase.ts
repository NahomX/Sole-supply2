import { createBrowserClient } from "@supabase/ssr";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type Role = "admin" | "submitter" | "customer";
export type ShoeStatus = "upcoming" | "available" | "sold";

export type Shoe = {
  id: string;
  url: string;
  title: string;
  brand: string | null;
  image_url: string | null;
  price_usd: number | null;
  sizes: string | null;
  notes: string | null;
  status: ShoeStatus;
  created_at: string;
};

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: Role;
  created_at: string;
};

export type Interest = {
  id: string;
  shoe_id: string;
  user_id: string;
  size: string | null;
  notes: string | null;
  created_at: string;
};

// Browser client — used from client components.
let browser: SupabaseClient | null = null;
export function supabaseBrowser(): SupabaseClient {
  if (!browser) {
    browser = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return browser;
}

// supabaseServer (cookie-aware, RLS-applying) lives in lib/supabase-server.ts
// because it imports next/headers, which can't be bundled into client components.
// Importing it here would pull next/headers into anything that touches this
// module — including the sign-in page, which is "use client".

// Service-role client for privileged writes that must bypass RLS
// (e.g., scraper insert, inviting users). Never expose to the browser.
export function supabaseService(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
