/**
 * lib/sizes.ts — Size availability utilities for the Berebaso storefront.
 *
 * Single source of truth for the men's US↔EU size grid.
 *
 * Phase 1: sizeGrid() is overloaded — it accepts either:
 *   (a) ShoeSize[] from the DB (authoritative, used by storefront + admin), or
 *   (b) a free-text string (legacy; kept for syncSizesFromText + backfill).
 *
 * EU sizes are approximate and vary by brand — this table is the best-effort
 * standard conversion used for display purposes only.
 */

import type { ShoeSize, LogisticsStatus } from "@/lib/supabase";
import type { SizeCustomerState } from "@/lib/labels";

// ---------------------------------------------------------------------------
// US ↔ EU conversion table
// Order matters — grid renders in this order (US 7 → 13).
// ---------------------------------------------------------------------------

export type SizeEntry = {
  us: string; // e.g. "7", "7.5"
  eu: string; // e.g. "40", "40.5"
};

/**
 * Canonical Men's US↔EU size grid (US 7–13).
 *
 * EU values are approximate and vary by brand.
 */
export const SIZE_GRID: SizeEntry[] = [
  { us: "7",    eu: "40"   },
  { us: "7.5",  eu: "40.5" },
  { us: "8",    eu: "41"   },
  { us: "8.5",  eu: "42"   },
  { us: "9",    eu: "42.5" },
  { us: "9.5",  eu: "43"   },
  { us: "10",   eu: "44"   },
  { us: "10.5", eu: "44.5" },
  { us: "11",   eu: "45"   },
  { us: "11.5", eu: "45.5" },
  { us: "12",   eu: "46"   },
  { us: "12.5", eu: "47"   },
  { us: "13",   eu: "47.5" },
];

// ---------------------------------------------------------------------------
// Lookup maps (built once at module load)
// ---------------------------------------------------------------------------

/** All valid US size strings in the grid, for fast membership checks. */
const VALID_US = new Set(SIZE_GRID.map((e) => e.us));

/** EU → US lookup: "40" → "7", "40.5" → "7.5", etc. */
const EU_TO_US = new Map(SIZE_GRID.map((e) => [e.eu, e.us]));

// ---------------------------------------------------------------------------
// Parsing helpers (used by backfill SQL logic mirror + syncSizesFromText)
// ---------------------------------------------------------------------------

/**
 * Normalise a raw token string into a canonical numeric-string form.
 * Strips "US", "EU", quotes, stray letters, commas inside a number, etc.
 * Returns the cleaned string, or null if it's clearly not a number.
 *
 * Examples:
 *   "US10"  → "10"
 *   "10.5"  → "10.5"
 *   '"8"'   → "8"
 *   "EU40"  → "40"
 *   "size8" → "8"
 */
function cleanToken(raw: string): string | null {
  // Remove surrounding quotes, dashes used as decoration at string boundaries
  let s = raw.replace(/^["']+|["']+$/g, "").trim();
  // Strip non-numeric prefix/suffix labels ("US", "EU", "size", etc.)
  s = s.replace(/^[a-zA-Z\s]+/, "").replace(/[a-zA-Z\s]+$/, "").trim();
  if (!s) return null;
  // Must be a plausible number (digits, optional single dot, optional trailing half)
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return s;
}

/**
 * Expand an integer range token "lo-hi" into individual integer size strings.
 * Returns null if it doesn't match the range pattern or values are out of bounds.
 *
 * "8-12" → ["8", "9", "10", "11", "12"]
 *
 * Only whole-number ranges are expanded — "8.5-10" is NOT treated as a range
 * (a dash in "8.5-10" is ambiguous; both 8.5 and 10 are parsed separately).
 */
function expandRange(token: string): string[] | null {
  const m = token.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
  if (!m) return null;
  const lo = parseInt(m[1], 10);
  const hi = parseInt(m[2], 10);
  if (lo >= hi || hi - lo > 20) return null; // sanity: max 20-step range
  const out: string[] = [];
  for (let i = lo; i <= hi; i++) out.push(String(i));
  return out;
}

/**
 * Parse the shoe's free-text `sizes` field into the set of available US sizes.
 *
 * Handles:
 *   - Comma/space/slash/semicolon/pipe separators:
 *       "8, 9, 10"  /  "8 9 10"  /  "8/9/10"  /  "8;9;10"  /  "8|9|10"
 *   - Integer ranges (whole numbers only):
 *       "8-12" → 8, 9, 10, 11, 12
 *   - Explicit half sizes:
 *       "8.5"  /  "10.5"
 *   - Stray "US" / "EU" / quote labels:
 *       "US 9"  /  'US10'  /  '"9.5"'
 *   - EU numbers that map to a US grid value:
 *       "EU 44" / "44" when EU 44 = US 10 → adds "10"
 *   - Tokens that don't match any grid size are silently ignored (lenient).
 *
 * If `sizesText` is null/empty/blank, returns an empty Set.
 */
export function parseAvailableSizes(sizesText: string | null): Set<string> {
  const available = new Set<string>();
  if (!sizesText) return available;

  // Split on any combination of commas, semicolons, pipes, slashes, or runs of whitespace.
  // But preserve dash-range tokens like "8-12" by NOT splitting on "-" here.
  const rawTokens = sizesText.split(/[,;|/]+|\s+/);

  for (const raw of rawTokens) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // Try range expansion first (only matches whole-number dash ranges)
    const expanded = expandRange(trimmed);
    if (expanded) {
      for (const s of expanded) {
        if (VALID_US.has(s)) available.add(s);
        else {
          // Range token could be EU numbers — map if possible
          const usEquiv = EU_TO_US.get(s);
          if (usEquiv) available.add(usEquiv);
        }
      }
      continue;
    }

    // Clean the token (strip labels, quotes)
    const cleaned = cleanToken(trimmed);
    if (!cleaned) continue;

    // Check direct US match first
    if (VALID_US.has(cleaned)) {
      available.add(cleaned);
      continue;
    }

    // Check EU → US conversion
    const usEquiv = EU_TO_US.get(cleaned);
    if (usEquiv) {
      available.add(usEquiv);
    }
    // If neither, silently ignore (lenient behaviour)
  }

  return available;
}

// ---------------------------------------------------------------------------
// Grid builders
// ---------------------------------------------------------------------------

/**
 * Per-size grid entry with a derived customer state.
 * Used by the storefront (SizeStrip) when shoe_sizes data is available.
 */
export type SizeGridEntry = {
  us: string;
  eu: string;
  /** Present when built from shoe_sizes rows. */
  customerState?: SizeCustomerState;
  /** True when the size exists in shoe_sizes. False = not listed. */
  available: boolean;
  /** The raw logistics status from shoe_sizes (null = not started / not listed). */
  logistics_status?: LogisticsStatus | null;
};

/**
 * Derive customer-visible state from a logistics status.
 * Mirrors sizeLabel() from lib/labels.ts but returns just the state string
 * so sizes.ts doesn't need to import labels.ts (avoids circular dep).
 */
function logisticsToCustomerState(
  ls: LogisticsStatus | null
): SizeCustomerState {
  if (ls === "arrived") return "in-stock";
  if (ls === "purchased") return "on-the-way";
  if (ls === "delivered") return "sold-out";
  return "coming-soon"; // in_cart or null
}

/**
 * Build the full size grid from shoe_sizes DB rows (authoritative, Phase 1+).
 *
 * - Sizes that exist in shoe_sizes → available=true with their logistics state.
 * - Sizes absent from shoe_sizes → available=false, customerState=sold-out.
 *   (absent = was never listed, so effectively sold out / not offered)
 *
 * If `shoeSizes` is empty, caller should omit the strip or show "Sizes TBA".
 */
export function sizeGridFromSizes(shoeSizes: ShoeSize[]): SizeGridEntry[] {
  const byUs = new Map(shoeSizes.map((sz) => [sz.us_size, sz]));
  return SIZE_GRID.map((e) => {
    const row = byUs.get(e.us);
    if (!row) {
      return {
        us: e.us,
        eu: e.eu,
        available: false,
        customerState: "sold-out" as SizeCustomerState,
        logistics_status: null,
      };
    }
    return {
      us: e.us,
      eu: e.eu,
      available: true,
      customerState: logisticsToCustomerState(row.logistics_status),
      logistics_status: row.logistics_status,
    };
  });
}

/**
 * Legacy grid builder from free-text — kept for any callers that don't yet
 * have shoe_sizes rows (e.g. newly submitted shoes before admin adds sizes).
 *
 * If parsing yields zero usable sizes (null/blank/garbled input), the caller
 * should omit the grid rather than show an all-sold-out display (misleading).
 */
export function sizeGrid(sizesText: string | null): SizeGridEntry[] {
  const available = parseAvailableSizes(sizesText);
  return SIZE_GRID.map((e) => ({
    us: e.us,
    eu: e.eu,
    available: available.has(e.us),
    customerState: available.has(e.us)
      ? ("coming-soon" as SizeCustomerState)
      : ("sold-out" as SizeCustomerState),
  }));
}
