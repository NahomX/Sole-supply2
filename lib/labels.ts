import type { Shoe } from "@/lib/supabase";

/**
 * Customer-facing label derived from the two-status-track model.
 *
 * Internal enums (ShoeStatus + LogisticsStatus) are NEVER shown to customers.
 * This is the single source of truth for the mapping table:
 *
 * | sales status | logistics status         | customer label |
 * |--------------|--------------------------|----------------|
 * | available    | any                      | In stock       |
 * | upcoming     | purchased / arrived      | On the way     |
 * | upcoming     | in_cart / null           | Coming soon    |
 * | sold         | any                      | Sold           |
 * | any          | delivered                | (per sales)    |
 *
 * Note: 'delivered' means the shoe has been handed off; the sales status
 * (usually 'sold') determines where it appears.
 *
 * Badge palette (closed — do not add new colours without updating this table):
 * - "In stock"    → brand.green #1F7A52, white text
 * - "On the way"  → brand.gold  #E8B53A, dark text (contrast: ~8:1 vs black)
 * - "Coming soon" → brand.espresso #2A1A12, white text
 * - "Sold"        → neutral-700, white text
 */
export type CustomerLabel = {
  text: string;
  /** Tailwind class string for the badge background + text color */
  className: string;
  /** Which homepage section this shoe belongs in */
  section: "in-stock" | "on-the-way" | "coming-soon" | "previously";
};

export function customerLabel(shoe: Shoe): CustomerLabel {
  const { status, logistics_status } = shoe;

  // Sold (or delivered + sold) → Previously section, dimmed.
  if (status === "sold") {
    return {
      text: "Sold",
      className: "bg-neutral-700 text-white",
      section: "previously",
    };
  }

  // Available → In stock.
  // Uses brand.green (#1F7A52) for badge — brand-aligned muted green.
  if (status === "available") {
    return {
      text: "In stock",
      className: "bg-[#1F7A52] text-white",
      section: "in-stock",
    };
  }

  // upcoming from here on.
  // If logistics has confirmed procurement (purchased or arrived) → On the way.
  // Gold badge (#E8B53A) with dark text — gold background fails WCAG AA with white
  // text (contrast ~2.5:1) but passes comfortably with near-black (~8:1).
  if (
    logistics_status === "purchased" ||
    logistics_status === "arrived" ||
    logistics_status === "delivered"
  ) {
    return {
      text: "On the way",
      className: "bg-[#E8B53A] text-neutral-900",
      section: "on-the-way",
    };
  }

  // in_cart or null → Coming soon (not yet bought).
  // Espresso (#2A1A12) — brand coffee tone, warm vs the former boilerplate neutral-900.
  return {
    text: "Coming soon",
    className: "bg-[#2A1A12] text-white",
    section: "coming-soon",
  };
}
