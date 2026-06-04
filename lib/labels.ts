import type { Shoe, ShoeSize, LogisticsStatus } from "@/lib/supabase";

/**
 * Customer-facing labels derived from the two-status-track model.
 *
 * Phase 1: logistics status now lives in shoe_sizes (per-size). The shoe-level
 * label is derived from the *best* (most-progressed) size status across all
 * shoe_sizes rows. The section assignment follows the same rule.
 *
 * Per-size customer states (sizeLabel):
 * | logistics_status | customer state |
 * |------------------|----------------|
 * | arrived          | in-stock       |
 * | purchased        | on-the-way     |
 * | in_cart / null   | coming-soon    |
 * | delivered        | sold-out       |
 * | (absent)         | sold-out       |
 *
 * Shoe-level section (shoeSection / customerLabel):
 * | sales status | best size state          | section      |
 * |--------------|--------------------------|--------------|
 * | sold         | any                      | previously   |
 * | available    | any                      | in-stock     |
 * | upcoming     | any size arrived         | in-stock     |
 * | upcoming     | any size purchased       | on-the-way   |
 * | upcoming     | any size in_cart / null  | coming-soon  |
 * | upcoming     | no sizes at all          | coming-soon  |
 *
 * Badge palette (closed — do not add colours without updating this table):
 * - "In stock"    → brand.green #1F7A52, white text
 * - "On the way"  → brand.gold  #E8B53A, dark text (contrast: ~8:1 vs black)
 * - "Coming soon" → brand.espresso #2A1A12, white text
 * - "Sold"        → neutral-700, white text
 */

export type SizeCustomerState =
  | "in-stock"
  | "on-the-way"
  | "coming-soon"
  | "sold-out";

/** Human-readable chip label + Tailwind classes for one per-size chip. */
export type SizeLabel = {
  state: SizeCustomerState;
  text: string;
  /** Tailwind classes for the chip background + text. */
  chipClass: string;
};

/**
 * Derive the customer-facing state for a single size based on its
 * logistics_status. Absent / null = coming soon; delivered = sold out.
 */
export function sizeLabel(status: LogisticsStatus | null): SizeLabel {
  switch (status) {
    case "arrived":
      return {
        state: "in-stock",
        text: "In stock",
        chipClass: "bg-[#1F7A52] text-white",
      };
    case "purchased":
      return {
        state: "on-the-way",
        text: "On the way",
        chipClass: "bg-[#E8B53A] text-neutral-900",
      };
    case "delivered":
      return {
        state: "sold-out",
        text: "Sold out",
        chipClass: "bg-neutral-50 text-neutral-400",
      };
    case "in_cart":
    case null:
    default:
      return {
        state: "coming-soon",
        text: "Coming soon",
        chipClass: "bg-neutral-100 text-neutral-600",
      };
  }
}

export type CustomerLabel = {
  text: string;
  /** Tailwind class string for the badge background + text color */
  className: string;
  /** Which homepage section this shoe belongs in */
  section: "in-stock" | "on-the-way" | "coming-soon" | "previously";
};

/**
 * Derive the best homepage section for a shoe based on its sales status and
 * the best (most-progressed) logistics status across all its sizes.
 *
 * Priority: in-stock > on-the-way > coming-soon > previously.
 */
export function shoeSection(
  shoe: Pick<Shoe, "status" | "shoe_sizes">
): "in-stock" | "on-the-way" | "coming-soon" | "previously" {
  const { status } = shoe;

  if (status === "sold") return "previously";
  if (status === "available") return "in-stock";

  // upcoming — check best size status.
  const sizes: ShoeSize[] = shoe.shoe_sizes ?? [];

  const hasArrived = sizes.some((sz) => sz.logistics_status === "arrived");
  if (hasArrived) return "in-stock";

  const hasPurchased = sizes.some((sz) => sz.logistics_status === "purchased");
  if (hasPurchased) return "on-the-way";

  // in_cart, null, delivered, or no sizes → coming soon (delivered is an
  // edge case where shoe is upcoming but a size was handed off early; treat
  // as coming-soon rather than hiding it).
  return "coming-soon";
}

/**
 * Full customer label (badge text + CSS classes + section) for a shoe.
 * Refactored to use shoeSection internally; result is identical to the
 * old per-shoe logistics_status derivation when called with a joined shoe.
 */
export function customerLabel(shoe: Shoe): CustomerLabel {
  const section = shoeSection(shoe);

  switch (section) {
    case "in-stock":
      return {
        text: "In stock",
        className: "bg-[#1F7A52] text-white",
        section: "in-stock",
      };
    case "on-the-way":
      return {
        text: "On the way",
        className: "bg-[#E8B53A] text-neutral-900",
        section: "on-the-way",
      };
    case "previously":
      return {
        text: "Sold",
        className: "bg-neutral-700 text-white",
        section: "previously",
      };
    case "coming-soon":
    default:
      return {
        text: "Coming soon",
        className: "bg-[#2A1A12] text-white",
        section: "coming-soon",
      };
  }
}
