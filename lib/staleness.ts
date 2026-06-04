import type { Shoe } from "@/lib/supabase";

/**
 * Staleness helpers — single source of truth for the 7-day stale rule.
 *
 * A shoe is "stale" when ALL of the following are true:
 *   1. sales status is 'upcoming' (not yet available or sold)
 *   2. logistics_status is null (procurement has not started at all)
 *   3. created_at is older than STALE_THRESHOLD_DAYS
 *
 * A shoe that is 'upcoming' but already has a logistics status
 * (in_cart, purchased, arrived, or delivered) is progressing and
 * is NOT stale — the pipeline is moving.
 */

export const STALE_THRESHOLD_DAYS = 7;

/**
 * Returns true if the shoe meets the stale criteria.
 * Pass `now` explicitly so callers can test with a fixed instant.
 */
export function isStale(shoe: Shoe, now: Date): boolean {
  if (shoe.status !== "upcoming") return false;
  if (shoe.logistics_status !== null) return false;
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
