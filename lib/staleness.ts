import type { Shoe } from "@/lib/supabase";

/**
 * Staleness helpers — single source of truth for the 7-day stale rule.
 *
 * Phase 1: logistics status is now per-size in shoe_sizes. A shoe is "stale"
 * when ALL of the following are true:
 *   1. sales status is 'upcoming' (not yet available or sold)
 *   2. ALL of its sizes are null or in_cart (no size has progressed beyond cart)
 *      OR it has no sizes at all (nothing added yet)
 *   3. created_at is older than STALE_THRESHOLD_DAYS
 *
 * A shoe where any size is 'purchased', 'arrived', or 'delivered' is progressing
 * and is NOT stale — the pipeline is moving for at least one size.
 */

export const STALE_THRESHOLD_DAYS = 7;

/**
 * Returns true if the shoe meets the stale criteria.
 * The shoe must be passed with its `shoe_sizes` array joined in (from getAllShoes
 * or similar). If shoe_sizes is absent, falls back to the old nil-logistics rule.
 *
 * Pass `now` explicitly so callers can test with a fixed instant.
 */
export function isStale(shoe: Shoe, now: Date): boolean {
  if (shoe.status !== "upcoming") return false;

  // Phase 1: check per-size logistics statuses.
  const sizes = shoe.shoe_sizes;
  if (sizes !== undefined) {
    // If any size has made progress (beyond null/in_cart), not stale.
    const hasProgress = sizes.some(
      (sz) =>
        sz.logistics_status === "purchased" ||
        sz.logistics_status === "arrived" ||
        sz.logistics_status === "delivered"
    );
    if (hasProgress) return false;
    // All null/in_cart (or no sizes) — still stale if old enough.
  }

  const ageMs = now.getTime() - new Date(shoe.created_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays > STALE_THRESHOLD_DAYS;
}

/**
 * Returns how many full days old the shoe is (rounded down).
 * Useful for rendering "Stale · 12d" badges.
 */
export function staleAgeDays(shoe: Shoe, now: Date): number {
  const ageMs = now.getTime() - new Date(shoe.created_at).getTime();
  return Math.floor(ageMs / (1000 * 60 * 60 * 24));
}
