/**
 * lib/shoes.ts — shared shoe business logic.
 *
 * Both the web API routes and the Telegram bots call these helpers so there is
 * a single source of truth for validation, scraping, and DB writes.
 *
 * IMPORTANT: this module must stay server-only (it uses supabaseService which
 * holds the service-role key). Never import it from a "use client" component.
 *
 * Phase 1 note: logistics status is now tracked per-size in shoe_sizes.
 * The per-shoe setLogisticsStatus helper is REMOVED. Use setSizeStatus or
 * advanceAllSizes instead. The bots use advanceAllSizes (interim) until
 * Phase 2 ships the per-size drill-down UX.
 */

import { supabaseService } from "@/lib/supabase";
import type { Shoe, ShoeSize, ShoeStatus, LogisticsStatus } from "@/lib/supabase";
import { scrapeOpenGraph } from "@/lib/scrape";
import { brandFromUrl } from "@/lib/brand";
import { sendTelegramMessage } from "@/lib/telegram";
import { parseAvailableSizes } from "@/lib/sizes";

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
// insertEvent — fire-and-forget audit log write to shoe_events.
// Wrapped in try/catch so a DB hiccup never breaks the status transition.
// Only fires after migration 0010_shoe_events.sql has been run by the user.
// ---------------------------------------------------------------------------

type EventType =
  | "shoe_created"
  | "sales_status_change"
  | "logistics_status_change"
  | "shoe_edit"
  | "shoe_removed";

async function insertEvent(opts: {
  shoeId: string;
  usSize?: string | null;
  eventType: EventType;
  fromValue: string | null;
  toValue: string | null;
  meta?: FeedMeta;
}): Promise<void> {
  try {
    const db = supabaseService();
    const { error } = await db.from("shoe_events").insert({
      shoe_id: opts.shoeId,
      us_size: opts.usSize ?? null,
      event_type: opts.eventType,
      from_value: opts.fromValue,
      to_value: opts.toValue,
      actor: opts.meta?.actorLabel ?? null,
      source: opts.meta?.source ?? null,
    });
    if (error) {
      console.error("[shoe-events] insert failed:", error.message);
    }
  } catch (err) {
    // Never propagate — an event-log failure must never break a status transition.
    console.error("[shoe-events] insert failed (exception):", (err as Error).message ?? err);
  }
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
  /**
   * Initial logistics status for all sizes (used by incart bot).
   * If set + sizes are parseable, shoe_sizes rows are created at this status.
   * If set but sizes is null/blank, no shoe_sizes rows are created now
   * (admin can add sizes manually via the per-size editor).
   *
   * The old `logistics_status` field on shoes is gone (dropped in 0005).
   * We keep this param name-compatible with the incart bot caller.
   */
  initial_logistics_status?: LogisticsStatus | null;
  /**
   * @deprecated Use initial_logistics_status. Kept for backward compat with
   * existing bot callers that pass `logistics_status`. Treated identically.
   */
  logistics_status?: LogisticsStatus | null;
  /** Optional context for the ops feed. Does not affect the DB write. */
  meta?: FeedMeta;
};

export type CreateShoeResult =
  | { shoe: Shoe; error: null }
  | { shoe: null; error: string };

/**
 * Scrape Open Graph data from `url`, merge with any caller-supplied overrides,
 * and insert a new shoe row (status = 'upcoming' by default).
 *
 * If initial_logistics_status (or legacy logistics_status) is 'in_cart',
 * a one-line ops feed message is posted fire-and-forget.
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

  const sizesText = input.sizes ?? null;
  // Accept either param name for backward compat with incart bot.
  const initLs = input.initial_logistics_status ?? input.logistics_status ?? null;

  const row = {
    url,
    title: (input.title ?? scraped.title ?? url).toString().slice(0, 300),
    brand,
    image_url: input.image_url ?? scraped.image ?? null,
    price_usd: input.price_usd ?? scraped.price ?? null,
    sizes: sizesText,
    notes: input.notes ?? null,
    status: "upcoming" as ShoeStatus,
    // logistics_status column dropped in 0005 — not written here
  };

  const db = supabaseService();
  const { data, error } = await db.from("shoes").insert(row).select().single();
  if (error) return { shoe: null, error: error.message };
  const shoe = data as Shoe;

  // Seed shoe_sizes rows if an initial logistics status was supplied.
  if (initLs !== null && sizesText) {
    const parsed = parseAvailableSizes(sizesText);
    if (parsed.size > 0) {
      const sizeRows = Array.from(parsed).map((us) => ({
        shoe_id: shoe.id,
        us_size: us,
        logistics_status: initLs,
      }));
      await db.from("shoe_sizes").insert(sizeRows);
    }
  }

  // Post to ops feed only when the shoe is created with in_cart status
  // (i.e. via the incart bot). Regular web submits are not posted here.
  if (initLs === "in_cart") {
    await postOpsFeed(
      `\u{1F195} ${shoe.title} added to in-cart${buildFeedSuffix(meta)}`
    );
  }

  // Audit event: record shoe creation.
  await insertEvent({
    shoeId: shoe.id,
    eventType: "shoe_created",
    fromValue: null,
    toValue: shoe.status,
    meta,
  });

  return { shoe, error: null };
}

// ---------------------------------------------------------------------------
// setSalesStatus
// ---------------------------------------------------------------------------

export type UpdateResult =
  | { shoe: Shoe; error: null }
  | { shoe: null; error: string };

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

  // Only post / record when the value actually changed.
  if (before?.status !== to) {
    await postOpsFeed(
      `\u{1F45F} ${shoe.title} \u{2192} ${to}${buildFeedSuffix(meta)}`
    );
    // Audit event: record sales status transition.
    await insertEvent({
      shoeId: id,
      eventType: "sales_status_change",
      fromValue: before?.status ?? null,
      toValue: to,
      meta,
    });
  }

  // When a shoe goes in stock, its listed sizes become buyable now — so the
  // storefront should show them as available (green). The size grid keys
  // "available" strictly on logistics_status = 'arrived', so promote any size
  // still in the procurement pipeline (null / in_cart / purchased) to 'arrived'.
  // 'delivered' (sold) sizes are left untouched so they stay greyed out.
  // Fire-and-forget: a size-sync failure must never break the sales-status update.
  if (to === "available") {
    try {
      await db
        .from("shoe_sizes")
        .update({ logistics_status: "arrived" })
        .eq("shoe_id", id)
        .or("logistics_status.is.null,logistics_status.in.(in_cart,purchased)");
    } catch {
      // Ignore — storefront falls back to whatever per-size statuses exist.
    }
  }

  return { shoe, error: null };
}

// ---------------------------------------------------------------------------
// updateShoeField — edit ONE scalar field on a shoe (Telegram site-edit bot).
// ---------------------------------------------------------------------------

/** Shoe fields editable via updateShoeField. Sizes + sales status are edited
 * through their dedicated helpers (syncSizesFromText, setSalesStatus). */
export type EditableShoeField = "title" | "brand" | "price_usd" | "notes";

const EDITABLE_FIELDS: EditableShoeField[] = [
  "title",
  "brand",
  "price_usd",
  "notes",
];

/**
 * Update ONE of {title, brand, price_usd, notes} on a shoe by ID.
 * Validates `field` against the allowlist; coerces price_usd to a number.
 * Records a 'shoe_edit' audit event (from old value → new value) and posts a
 * one-line ops-feed summary. Returns the updated shoe row.
 */
export async function updateShoeField(
  id: string,
  field: EditableShoeField,
  value: string | number | null,
  meta?: FeedMeta
): Promise<UpdateResult> {
  if (!EDITABLE_FIELDS.includes(field)) {
    return { shoe: null, error: "invalid field" };
  }

  // Coerce + validate the new value per field.
  let newValue: string | number | null;
  if (field === "price_usd") {
    if (value === null || value === "") {
      newValue = null;
    } else {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) {
        return { shoe: null, error: "invalid price" };
      }
      newValue = n;
    }
  } else {
    newValue = value === null ? null : String(value);
  }

  const db = supabaseService();

  // Fetch current value so the audit event records the real transition.
  const { data: before } = await db
    .from("shoes")
    .select(`title,${field}`)
    .eq("id", id)
    .single();
  const prev = (before as Record<string, unknown> | null)?.[field] ?? null;

  const { data, error } = await db
    .from("shoes")
    .update({ [field]: newValue })
    .eq("id", id)
    .select()
    .single();
  if (error) return { shoe: null, error: error.message };
  const shoe = data as Shoe;

  await postOpsFeed(
    `\u{270F}\u{FE0F} ${shoe.title} \u{2014} ${field} \u{2192} ${
      newValue ?? "cleared"
    }${buildFeedSuffix(meta)}`
  );

  // Audit event: record the field edit.
  await insertEvent({
    shoeId: id,
    eventType: "shoe_edit",
    fromValue: prev === null ? null : String(prev),
    toValue: newValue === null ? null : String(newValue),
    meta,
  });

  return { shoe, error: null };
}

// ---------------------------------------------------------------------------
// softRemoveShoe — hide a shoe from the storefront without deleting the row.
// ---------------------------------------------------------------------------

/**
 * Soft-remove a shoe by stamping removed_at = now(). The row is preserved (audit
 * trail intact); all customer/ops list queries filter `removed_at is null`.
 * Records a 'shoe_removed' audit event and posts a one-line ops-feed summary.
 */
export async function softRemoveShoe(
  id: string,
  meta?: FeedMeta
): Promise<{ error: string | null }> {
  const db = supabaseService();

  const { data, error } = await db
    .from("shoes")
    .update({ removed_at: new Date().toISOString() })
    .eq("id", id)
    .select("title")
    .single();
  if (error) return { error: error.message };

  const title = (data as { title: string } | null)?.title ?? id;
  await postOpsFeed(
    `\u{1F5D1}\u{FE0F} ${title} removed${buildFeedSuffix(meta)}`
  );

  // Audit event: record the soft-remove.
  await insertEvent({
    shoeId: id,
    eventType: "shoe_removed",
    fromValue: null,
    toValue: "removed",
    meta,
  });

  return { error: null };
}

// ---------------------------------------------------------------------------
// Per-size helpers
// ---------------------------------------------------------------------------

/** Fetch all shoe_sizes rows for a shoe. */
export async function getShoeSizes(
  shoeId: string
): Promise<{ sizes: ShoeSize[]; error: string | null }> {
  const db = supabaseService();
  const { data, error } = await db
    .from("shoe_sizes")
    .select("*")
    .eq("shoe_id", shoeId)
    .order("us_size");
  if (error) return { sizes: [], error: error.message };
  return { sizes: (data as ShoeSize[]) ?? [], error: null };
}

/**
 * Set the logistics_status for one (shoe, size) pair.
 * Dedupe: if the size row already has the same status, skips write + feed post.
 * Posts "👟 {title} — US {size} → {status}" to the ops feed on a real change.
 */
export async function setSizeStatus(
  shoeId: string,
  usSize: string,
  to: LogisticsStatus | null,
  meta?: FeedMeta
): Promise<{ size: ShoeSize | null; error: string | null }> {
  if (to !== null && !LOGISTICS.includes(to)) {
    return { size: null, error: "invalid logistics_status" };
  }
  const db = supabaseService();

  // Fetch current size row + shoe title for feed message.
  const [sizeQ, shoeQ] = await Promise.all([
    db
      .from("shoe_sizes")
      .select("*")
      .eq("shoe_id", shoeId)
      .eq("us_size", usSize)
      .maybeSingle(),
    db.from("shoes").select("title").eq("id", shoeId).single(),
  ]);

  const prev = (sizeQ.data as ShoeSize | null)?.logistics_status ?? null;

  // Upsert the size row at the new status.
  const { data, error } = await db
    .from("shoe_sizes")
    .upsert(
      { shoe_id: shoeId, us_size: usSize, logistics_status: to },
      { onConflict: "shoe_id,us_size" }
    )
    .select()
    .single();
  if (error) return { size: null, error: error.message };
  const size = data as ShoeSize;

  // Only post / record when the value actually changed.
  if (prev !== to) {
    const title = (shoeQ.data as { title: string } | null)?.title ?? shoeId;
    const label = to ?? "cleared";
    await postOpsFeed(
      `\u{1F45F} ${title} \u{2014} US ${usSize} \u{2192} ${label}${buildFeedSuffix(meta)}`
    );
    // Audit event: record per-size logistics transition.
    await insertEvent({
      shoeId,
      usSize,
      eventType: "logistics_status_change",
      fromValue: prev ?? "cleared",
      toValue: to ?? "cleared",
      meta,
    });
  }

  return { size, error: null };
}

/**
 * Add a size to a shoe (inserts with null logistics_status).
 * No-op if the size already exists (returns the existing row).
 * Admins only — shippers may only change status of existing sizes.
 */
export async function addSize(
  shoeId: string,
  usSize: string
): Promise<{ size: ShoeSize | null; error: string | null }> {
  const db = supabaseService();
  const { data, error } = await db
    .from("shoe_sizes")
    .insert({ shoe_id: shoeId, us_size: usSize, logistics_status: null })
    .select()
    .single();
  if (error) {
    // Unique-violation (23505) — size already exists; return it.
    if (error.code === "23505") {
      const { data: ex } = await db
        .from("shoe_sizes")
        .select("*")
        .eq("shoe_id", shoeId)
        .eq("us_size", usSize)
        .single();
      return { size: (ex as ShoeSize) ?? null, error: null };
    }
    return { size: null, error: error.message };
  }
  return { size: data as ShoeSize, error: null };
}

/**
 * Remove a size row from a shoe.
 * Admins only.
 */
export async function removeSize(
  shoeId: string,
  usSize: string
): Promise<{ error: string | null }> {
  const db = supabaseService();
  const { error } = await db
    .from("shoe_sizes")
    .delete()
    .eq("shoe_id", shoeId)
    .eq("us_size", usSize);
  if (error) return { error: error.message };
  return { error: null };
}

/**
 * Advance ALL eligible sizes of a shoe to `toStatus`.
 *
 * Interim bot behavior (Phase 1): work bots still tap a shoe → advance all
 * sizes so they keep working after shoes.logistics_status is dropped. Phase 2
 * will replace this with per-size drill-down multi-select in the bots.
 *
 * "Eligible" = sizes currently at the immediate predecessor of toStatus.
 * Predecessor map: in_cart→null, purchased→in_cart, arrived→purchased,
 * delivered→arrived.
 *
 * Posts a single feed message listing all advanced sizes.
 * Returns { count } = number of sizes actually advanced.
 */
export async function advanceAllSizes(
  shoeId: string,
  toStatus: LogisticsStatus,
  meta?: FeedMeta
): Promise<{ count: number; error: string | null }> {
  if (!LOGISTICS.includes(toStatus)) {
    return { count: 0, error: "invalid logistics_status" };
  }
  const db = supabaseService();

  const [sizesQ, shoeQ] = await Promise.all([
    db.from("shoe_sizes").select("*").eq("shoe_id", shoeId),
    db.from("shoes").select("title").eq("id", shoeId).single(),
  ]);
  if (sizesQ.error) return { count: 0, error: sizesQ.error.message };

  const sizes = (sizesQ.data as ShoeSize[]) ?? [];
  if (sizes.length === 0) return { count: 0, error: null };

  // Only advance sizes at the expected predecessor status.
  const predecessors: Record<LogisticsStatus, LogisticsStatus | null> = {
    in_cart: null,
    purchased: "in_cart",
    arrived: "purchased",
    delivered: "arrived",
  };
  const fromStatus = predecessors[toStatus];
  const eligible = sizes.filter((sz) => sz.logistics_status === fromStatus);
  if (eligible.length === 0) return { count: 0, error: null };

  const { error } = await db
    .from("shoe_sizes")
    .update({ logistics_status: toStatus })
    .eq("shoe_id", shoeId)
    .in("us_size", eligible.map((sz) => sz.us_size));
  if (error) return { count: 0, error: error.message };

  const title = (shoeQ.data as { title: string } | null)?.title ?? shoeId;
  const sizeList = eligible.map((sz) => `US ${sz.us_size}`).join(", ");
  await postOpsFeed(
    `\u{1F45F} ${title} \u{2014} ${sizeList} \u{2192} ${toStatus}${buildFeedSuffix(meta)}`
  );

  // Audit events: batch insert one event per advanced size.
  if (eligible.length > 0) {
    try {
      const db = supabaseService();
      const eventRows = eligible.map((sz) => ({
        shoe_id: shoeId,
        us_size: sz.us_size,
        event_type: "logistics_status_change" as EventType,
        from_value: fromStatus ?? "cleared",
        to_value: toStatus,
        actor: meta?.actorLabel ?? null,
        source: meta?.source ?? null,
      }));
      const { error: evtErr } = await db.from("shoe_events").insert(eventRows);
      if (evtErr) {
        console.error("[shoe-events] insert failed (advanceAllSizes):", evtErr.message);
      }
    } catch (err) {
      console.error("[shoe-events] insert failed (advanceAllSizes exception):", (err as Error).message ?? err);
    }
  }

  return { count: eligible.length, error: null };
}

/**
 * Sync shoe_sizes from a free-text sizes string (e.g. when admin edits sizes).
 * - Insert rows for newly listed US sizes (with null logistics_status).
 * - Delete rows for sizes no longer listed.
 * - Preserves existing logistics_status for sizes that remain.
 */
export async function syncSizesFromText(
  shoeId: string,
  sizesText: string | null
): Promise<{ error: string | null }> {
  const db = supabaseService();
  const desired = parseAvailableSizes(sizesText);

  const { data: existing, error: fetchErr } = await db
    .from("shoe_sizes")
    .select("us_size")
    .eq("shoe_id", shoeId);
  if (fetchErr) return { error: fetchErr.message };

  const existingSet = new Set(
    (existing as { us_size: string }[]).map((r) => r.us_size)
  );

  // Insert brand-new sizes.
  const toInsert = Array.from(desired)
    .filter((us) => !existingSet.has(us))
    .map((us) => ({ shoe_id: shoeId, us_size: us, logistics_status: null }));
  if (toInsert.length > 0) {
    const { error: insErr } = await db.from("shoe_sizes").insert(toInsert);
    if (insErr) return { error: insErr.message };
  }

  // Delete removed sizes.
  const toDelete = Array.from(existingSet).filter((us) => !desired.has(us));
  if (toDelete.length > 0) {
    const { error: delErr } = await db
      .from("shoe_sizes")
      .delete()
      .eq("shoe_id", shoeId)
      .in("us_size", toDelete);
    if (delErr) return { error: delErr.message };
  }

  return { error: null };
}

// ---------------------------------------------------------------------------
// List helpers
// ---------------------------------------------------------------------------

/**
 * Fetch shoes that have at least one size at `logisticsStatus`.
 * Returns shoes with their full shoe_sizes arrays (all sizes, not just matching).
 * Pass null to get shoes with no sizes started (all null or no shoe_sizes rows).
 */
export async function getShoesByLogistics(
  logisticsStatus: LogisticsStatus | null
): Promise<{ shoes: Shoe[]; error: string | null }> {
  const db = supabaseService();

  if (logisticsStatus === null) {
    // Unstarted: shoes where all sizes are null, or shoe has no size rows.
    // Soft-removed shoes (removed_at set) are excluded from all working views.
    const { data, error } = await db
      .from("shoes")
      .select("*, shoe_sizes(*)")
      .is("removed_at", null)
      .order("created_at", { ascending: true });
    if (error) return { shoes: [], error: error.message };
    const all = (data as Shoe[]) ?? [];
    const unstarted = all.filter((s) => {
      const szs = s.shoe_sizes ?? [];
      return szs.length === 0 || szs.every((sz) => sz.logistics_status === null);
    });
    return { shoes: unstarted, error: null };
  }

  // Shoes with at least one size at the given status — look up via shoe_sizes.
  const { data: sizeRows, error: sizeErr } = await db
    .from("shoe_sizes")
    .select("shoe_id")
    .eq("logistics_status", logisticsStatus);
  if (sizeErr) return { shoes: [], error: sizeErr.message };

  const ids = [...new Set((sizeRows as { shoe_id: string }[]).map((r) => r.shoe_id))];
  if (ids.length === 0) return { shoes: [], error: null };

  const { data, error } = await db
    .from("shoes")
    .select("*, shoe_sizes(*)")
    .in("id", ids)
    .is("removed_at", null)
    .order("created_at", { ascending: true });
  if (error) return { shoes: [], error: error.message };
  return { shoes: (data as Shoe[]) ?? [], error: null };
}

/** Fetch all shoes for admin/ops view (includes url + shoe_sizes). */
export async function getAllShoes(): Promise<{
  shoes: Shoe[];
  error: string | null;
}> {
  const db = supabaseService();
  // Soft-removed shoes are hidden from the ops/admin working views too.
  const { data, error } = await db
    .from("shoes")
    .select("*, shoe_sizes(*)")
    .is("removed_at", null)
    .order("created_at", { ascending: true });
  if (error) return { shoes: [], error: error.message };
  return { shoes: (data as Shoe[]) ?? [], error: null };
}

/**
 * Fetch shoes for the customer-facing view. Returns only fields safe to
 * show publicly — `url` is NEVER included (producer-URL redaction boundary).
 * Joins shoe_sizes so the storefront renders per-size status chips.
 */
export type PublicShoe = Omit<Shoe, "url">;

export async function getPublicShoes(filter?: {
  status?: ShoeStatus;
}): Promise<{ shoes: PublicShoe[]; error: string | null }> {
  const db = supabaseService();
  let q = db
    .from("shoes")
    .select("id,title,brand,image_url,price_usd,sizes,notes,status,created_at,shoe_sizes(*)")
    .is("removed_at", null)
    .order("created_at", { ascending: false });
  if (filter?.status) {
    q = q.eq("status", filter.status);
  }
  const { data, error } = await q;
  if (error) return { shoes: [], error: error.message };
  return { shoes: (data as PublicShoe[]) ?? [], error: null };
}
