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
  if (status === "available") {
    return {
      text: "In stock",
      className: "bg-green-600 text-white",
      section: "in-stock",
    };
  }

  // upcoming from here on.
  // If logistics has confirmed procurement (purchased or arrived) → On the way.
  if (
    logistics_status === "purchased" ||
    logistics_status === "arrived" ||
    logistics_status === "delivered"
  ) {
    return {
      text: "On the way",
      className: "bg-blue-600 text-white",
      section: "on-the-way",
    };
  }

  // in_cart or null → Coming soon (not yet bought).
  return {
    text: "Coming soon",
    className: "bg-neutral-900 text-white",
    section: "coming-soon",
  };
}
