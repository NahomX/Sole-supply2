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
import { sendTelegramMessage } from "@/lib/telegram";

// ---------------------------------------------------------------------------
// Ops feed — fire-and-forget push to the shared team group chat.
// Requires OPS_BOT_TOKEN + OPS_FEED_CHAT_ID to be set; silently no-ops if
// either is missing. Never throws — must never break a status update.
// ---------------------------------------------------------------------------

export type FeedMeta = {
  /** Human-readable label for who triggered the change (email or Telegram username). */
  actorLabel?: string;
  /** Where the action originated: "web", "incart", "purchaser", etc. */
  source?: string;
};

async function postOpsFeed(text: string): Promise<void> {
  const token = process.env.OPS_BOT_TOKEN;
  const chatId = process.env.OPS_FEED_CHAT_ID;
  if (!token || !chatId) return;
  try {
    // 3 s hard deadline so an awaited call never stalls the serverless function.
    await sendTelegramMessage(token, chatId, text, undefined, 3000);
  } catch {
    // Never propagate — a feed failure must never break a status transition.
    console.error("[ops-feed] failed to send message");
  }
}

function buildFeedSuffix(meta?: FeedMeta): string {
  if (!meta?.actorLabel && !meta?.source) return "";
  const parts: string[] = [];
  if (meta.actorLabel) parts.push(meta.actorLabel);
  if (meta.source) parts.push(`via ${meta.source}`);
  return ` (by ${parts.join(" ")})`;
}

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
  /** Optional context for the ops feed. Does not affect the DB write. */
  meta?: FeedMeta;
};

export type CreateShoeResult =
  | { shoe: Shoe; error: null }
  | { shoe: null; error: string };

/**
 * Scrape Open Graph data from `url`, merge with any caller-supplied overrides,
 * and insert a new shoe row (status = 'upcoming' by default, logistics_status
 * as supplied or null).
 *
 * If logistics_status is 'in_cart' (or any non-null value), a one-line ops feed
 * message is posted fire-and-forget to the shared team group chat.
 */
export async function createShoeFromUrl(
  input: CreateShoeInput
): Promise<CreateShoeResult> {
  const { url, meta } = input;
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
  const shoe = data as Shoe;

  // Post to ops feed only when the shoe is created with in_cart logistics status
  // (i.e. via the incart bot). Regular web submits (logistics_status = null) are
  // not posted here — they appear in the admin dashboard instead.
  // Fire-and-forget — never blocks or throws.
  if (row.logistics_status === "in_cart") {
    await postOpsFeed(
      `\u{1F195} ${shoe.title} added to in-cart${buildFeedSuffix(meta)}`
    );
  }

  return { shoe, error: null };
}

// ---------------------------------------------------------------------------
// setLogisticsStatus
// ---------------------------------------------------------------------------

export type UpdateResult =
  | { shoe: Shoe; error: null }
  | { shoe: null; error: string };

/**
 * Set `logistics_status` on a shoe by ID. Pass `null` to clear it.
 * Posts a one-line message to the ops feed (fire-and-forget) when the value
 * actually changes. Skips the post if the status is already equal to `to`.
 */
export async function setLogisticsStatus(
  id: string,
  to: LogisticsStatus | null,
  meta?: FeedMeta
): Promise<UpdateResult> {
  if (to !== null && !LOGISTICS.includes(to)) {
    return { shoe: null, error: "invalid logistics_status" };
  }
  const db = supabaseService();

  // Fetch current row first so we can (a) skip no-op updates and (b) have the
  // title for the feed message — all in one round-trip via the update+select.
  const { data: before } = await db
    .from("shoes")
    .select("logistics_status,title")
    .eq("id", id)
    .single();

  const { data, error } = await db
    .from("shoes")
    .update({ logistics_status: to })
    .eq("id", id)
    .select()
    .single();
  if (error) return { shoe: null, error: error.message };
  const shoe = data as Shoe;

  // Only post when the value actually changed.
  const prev = before?.logistics_status ?? null;
  if (prev !== to) {
    const label = to ?? "cleared";
    await postOpsFeed(
      `\u{1F45F} ${shoe.title} \u{2192} ${label}${buildFeedSuffix(meta)}`
    );
  }

  return { shoe, error: null };
}

// ---------------------------------------------------------------------------
// setSalesStatus
// ---------------------------------------------------------------------------

/**
 * Set `status` (sales status) on a shoe by ID.
 * Posts a one-line message to the ops feed (fire-and-forget) when the value
 * actually changes. Skips the post if the status is already equal to `to`.
 */
export async function setSalesStatus(
  id: string,
  to: ShoeStatus,
  meta?: FeedMeta
): Promise<UpdateResult> {
  if (!STATUSES.includes(to)) {
    return { shoe: null, error: "invalid status" };
  }
  const db = supabaseService();

  // Fetch current row so we can skip no-op updates for the feed.
  const { data: before } = await db
    .from("shoes")
    .select("status,title")
    .eq("id", id)
    .single();

  const { data, error } = await db
    .from("shoes")
    .update({ status: to })
    .eq("id", id)
    .select()
    .single();
  if (error) return { shoe: null, error: error.message };
  const shoe = data as Shoe;

  // Only post when the value actually changed.
  if (before?.status !== to) {
    await postOpsFeed(
      `\u{1F45F} ${shoe.title} \u{2192} ${to}${buildFeedSuffix(meta)}`
    );
  }

  return { shoe, error: null };
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
