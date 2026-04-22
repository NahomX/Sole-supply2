import { createClient, SupabaseClient } from "@supabase/supabase-js";

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

let browser: SupabaseClient | null = null;
export function supabaseBrowser(): SupabaseClient {
  if (!browser) {
    browser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return browser;
}

export function supabaseServer(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
