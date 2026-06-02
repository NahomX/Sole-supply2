/**
 * lib/shoes.ts — shared shoe business logic.
 *
 * Both the web API routes and the Telegram bots call these helpers so there is
 * a single source of truth for validation, scraping, and DB writes.
 *
 * IMPORTANT: this module must stay server-only (it uses supabaseService which
 * holds the service-role key). Never import it from a "use client" component.
 */

import { supabaseService } from "@/lib/supabase";
import type { Shoe, ShoeStatus, LogisticsStatus } from "@/lib/supabase";
import { scrapeOpenGraph } from "@/lib/scrape";
import { brandFromUrl } from "@/lib/brand";

// ---------------------------------------------------------------------------
// Canonical enum arrays — single source of truth used here + re-exported for
// API routes and bot handlers. DB check constraint and lib/supabase.ts types
// must stay in sync with these.
// ---------------------------------------------------------------------------

export const STATUSES: ShoeStatus[] = ["upcoming", "available", "sold"];
export const LOGISTICS: LogisticsStatus[] = [
  "in_cart",
  "purchased",
  "arrived",
  "delivered",
];

// ---------------------------------------------------------------------------
// createShoeFromUrl
// ---------------------------------------------------------------------------

export type CreateShoeInput = {
  url: string;
  title?: string | null;
  image_url?: string | null;
  price_usd?: number | null;
  sizes?: string | null;
  notes?: string | null;
  logistics_status?: LogisticsStatus | null;
};

export type CreateShoeResult =
  | { shoe: Shoe; error: null }
  | { shoe: null; error: string };

/**
 * Scrape Open Graph data from `url`, merge with any caller-supplied overrides,
 * and insert a new shoe row (status = 'upcoming' by default, logistics_status
 * as supplied or null).
 */
export async function createShoeFromUrl(
  input: CreateShoeInput
): Promise<CreateShoeResult> {
  const { url } = input;
  if (!/^https?:\/\//i.test(url)) {
    return { shoe: null, error: "invalid url" };
  }

  const scraped = await scrapeOpenGraph(url).catch(() => ({
    title: null,
    image: null,
    price: null,
  }));
  const brand = brandFromUrl(url);

  const row = {
    url,
    title: (input.title ?? scraped.title ?? url).toString().slice(0, 300),
    brand,
    image_url: input.image_url ?? scraped.image ?? null,
    price_usd: input.price_usd ?? scraped.price ?? null,
    sizes: input.sizes ?? null,
    notes: input.notes ?? null,
    status: "upcoming" as ShoeStatus,
    logistics_status: input.logistics_status ?? null,
  };

  const db = supabaseService();
  const { data, error } = await db.from("shoes").insert(row).select().single();
  if (error) return { shoe: null, error: error.message };
  return { shoe: data as Shoe, error: null };
}

// ---------------------------------------------------------------------------
// setLogisticsStatus
// ---------------------------------------------------------------------------

export type UpdateResult =
  | { shoe: Shoe; error: null }
  | { shoe: null; error: string };

/** Set `logistics_status` on a shoe by ID. Pass `null` to clear it. */
export async function setLogisticsStatus(
  id: string,
  to: LogisticsStatus | null
): Promise<UpdateResult> {
  if (to !== null && !LOGISTICS.includes(to)) {
    return { shoe: null, error: "invalid logistics_status" };
  }
  const db = supabaseService();
  const { data, error } = await db
    .from("shoes")
    .update({ logistics_status: to })
    .eq("id", id)
    .select()
    .single();
  if (error) return { shoe: null, error: error.message };
  return { shoe: data as Shoe, error: null };
}

// ---------------------------------------------------------------------------
// setSalesStatus
// ---------------------------------------------------------------------------

/** Set `status` (sales status) on a shoe by ID. */
export async function setSalesStatus(
  id: string,
  to: ShoeStatus
): Promise<UpdateResult> {
  if (!STATUSES.includes(to)) {
    return { shoe: null, error: "invalid status" };
  }
  const db = supabaseService();
  const { data, error } = await db
    .from("shoes")
    .update({ status: to })
    .eq("id", id)
    .select()
    .single();
  if (error) return { shoe: null, error: error.message };
  return { shoe: data as Shoe, error: null };
}

// ---------------------------------------------------------------------------
// List helpers
// ---------------------------------------------------------------------------

/** Fetch shoes by logistics_status. Pass null to get unstarted shoes. */
export async function getShoesByLogistics(
  logisticsStatus: LogisticsStatus | null
): Promise<{ shoes: Shoe[]; error: string | null }> {
  const db = supabaseService();
  let q = db.from("shoes").select("*").order("created_at", { ascending: true });
  if (logisticsStatus === null) {
    q = q.is("logistics_status", null);
  } else {
    q = q.eq("logistics_status", logisticsStatus);
  }
  const { data, error } = await q;
  if (error) return { shoes: [], error: error.message };
  return { shoes: (data as Shoe[]) ?? [], error: null };
}

/** Fetch all shoes for admin/ops view (includes url). */
export async function getAllShoes(): Promise<{
  shoes: Shoe[];
  error: string | null;
}> {
  const db = supabaseService();
  const { data, error } = await db
    .from("shoes")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) return { shoes: [], error: error.message };
  return { shoes: (data as Shoe[]) ?? [], error: null };
}

/**
 * Fetch shoes for the customer-facing view. Returns only fields safe to
 * show publicly — `url` is NEVER included (producer-URL redaction boundary).
 */
export type PublicShoe = Omit<Shoe, "url">;

export async function getPublicShoes(filter?: {
  status?: ShoeStatus;
}): Promise<{ shoes: PublicShoe[]; error: string | null }> {
  const db = supabaseService();
  let q = db
    .from("shoes")
    .select("id,title,brand,image_url,price_usd,sizes,notes,status,logistics_status,created_at")
    .order("created_at", { ascending: false });
  if (filter?.status) {
    q = q.eq("status", filter.status);
  }
  const { data, error } = await q;
  if (error) return { shoes: [], error: error.message };
  return { shoes: (data as PublicShoe[]) ?? [], error: null };
}
