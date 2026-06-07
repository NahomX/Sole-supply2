import { createBrowserClient } from "@supabase/ssr";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type Role = "admin" | "submitter" | "customer" | "shipper";
export type ShoeStatus = "upcoming" | "available" | "sold";
export type LogisticsStatus =
  | "in_cart"
  | "purchased"
  | "arrived"
  | "delivered";

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
  // logistics_status has moved to shoe_sizes (per-size). shoes rows no longer
  // carry this field after migration 0005_shoe_sizes runs. Code that needs
  // the aggregate logistics picture uses the joined shoe_sizes array instead.
  created_at: string;
  /** Populated when the query joins shoe_sizes (e.g. getPublicShoes, getAllShoes). */
  shoe_sizes?: ShoeSize[];
};

/** One row in shoe_sizes — one size of a shoe + its logistics status. */
export type ShoeSize = {
  id: string;
  shoe_id: string;
  /** Canonical US size string from SIZE_GRID, e.g. "9", "10.5". */
  us_size: string;
  /** null = listed / not started; non-null = in pipeline. */
  logistics_status: LogisticsStatus | null;
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

/** One row in shoe_events — timestamped audit log for all shoe status transitions. */
export type ShoeEvent = {
  id: string;
  shoe_id: string;
  /** US size string (e.g. "9", "10.5") for per-size events; null for shoe-level events. */
  us_size: string | null;
  event_type: "shoe_created" | "sales_status_change" | "logistics_status_change";
  /** Previous value (null for creation events). */
  from_value: string | null;
  /** New value. */
  to_value: string | null;
  /** Human-readable actor label (email or Telegram username). */
  actor: string | null;
  /** Source channel: 'web', 'incart', 'purchaser', 'work', 'agent', etc. */
  source: string | null;
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
