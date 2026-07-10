import { createBrowserClient } from "@supabase/ssr";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/** Guard: the Supabase URL must be a valid https URL. Global env vars on
 *  Windows sometimes contain a malformed value that crashes createClient. */
function validSupabaseUrl(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

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
  /** Admin-set local price in Ethiopian birr (migration 0012). Customer-facing:
   * shown when set; "Contact for price" otherwise. Must be > 0 when set. */
  price_etb: number | null;
  sizes: string | null;
  notes: string | null;
  /** Public URL of the per-shoe hands-on video (migration 0012; usually in the
   * 'shoe-videos' storage bucket). null = no video, storefront hides the play tile. */
  video_url: string | null;
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

export type PaymentStatus = "pending" | "paid" | "failed";

/** One row in the payments table (admin-only, service-role access). */
export type Payment = {
  id: string;
  shoe_id: string | null;
  size: string | null;
  amount: number;
  currency: string;
  tx_ref: string;
  status: PaymentStatus;
  chapa_ref: string | null;
  customer_email: string | null;
  created_at: string;
  updated_at: string;
};

// Browser client — used from client components.
let browser: SupabaseClient | null = null;
export function supabaseBrowser(): SupabaseClient {
  if (!browser) {
    if (!validSupabaseUrl()) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL is missing or malformed. Check your .env.local."
      );
    }
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
// Lenient guard: logs a warning but does NOT throw — the Supabase client
// tolerates a bad URL at creation time and fails gracefully on queries,
// which the callers already handle (e.g. getShoes() returns []). Throwing
// here would break `next build` when a global malformed env var is present.
export function supabaseService(): SupabaseClient {
  if (!validSupabaseUrl()) {
    console.warn(
      "[supabase] NEXT_PUBLIC_SUPABASE_URL is missing or malformed — DB calls will fail."
    );
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } }
  );
}
