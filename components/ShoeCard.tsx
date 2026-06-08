"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Shoe, ShoeSize } from "@/lib/supabase";
import { customerLabel } from "@/lib/labels";
import { sizeGridFromSizes, parseAvailableSizes } from "@/lib/sizes";

type Mode = "idle" | "info" | "request";

export function ShoeCard({
  shoe,
  dim = false,
  signedIn = false,
  isAdmin = false,
  alreadyRequested = false,
}: {
  shoe: Shoe;
  dim?: boolean;
  signedIn?: boolean;
  isAdmin?: boolean;
  alreadyRequested?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [size, setSize] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Tracks whether the product image has errored so we can show the empty state.
  const [imgError, setImgError] = useState(false);

  const reviewsUrl = `https://www.google.com/search?q=${encodeURIComponent(
    `${shoe.title} reviews`
  )}`;

  const label = customerLabel(shoe);
  const canShowRequest =
    shoe.status !== "sold" && signedIn && !alreadyRequested;

  async function send() {
    setLoading(true);
    setErr(null);
    const res = await fetch("/api/interests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shoe_id: shoe.id,
        size: size || null,
        notes: notes || null,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "Failed to send.");
    } else {
      setMode("idle");
      router.refresh();
    }
  }

  return (
    /*
      Visual polish:
      - rounded-xl (up from rounded-lg) + resting shadow-sm
      - hover: subtle lift (-translate-y-0.5) + deeper shadow + lighter border
      - GPU-only transitions: transform + shadow (no layout reflow)
      - group class enables image zoom on card hover
    */
    <div
      className={`group rounded-xl border border-neutral-200 overflow-hidden bg-white flex flex-col shadow-sm transition-shadow transition-transform duration-200 hover:shadow-lg hover:-translate-y-0.5 hover:border-neutral-300 ${
        dim ? "opacity-50" : ""
      }`}
    >
      <div className="aspect-square bg-neutral-100 relative overflow-hidden">
        {shoe.image_url && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shoe.image_url}
            alt={shoe.title}
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={() => setImgError(true)}
          />
        ) : (
          /*
            Empty/error state — shown when image_url is missing OR when the
            image fails to load (dead URL, CORS block, retailer CDN change).
            Product images come from arbitrary retailer hosts (the scraper
            accepts any URL), so load errors are expected and this fallback
            is the correct resilience mechanism — not restricting remotePatterns.
          */
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-neutral-400">
            <svg
              aria-hidden="true"
              width="32"
              height="32"
              viewBox="0 0 64 64"
              fill="none"
              className="text-neutral-300"
            >
              <path
                d="M8 44c0 0 4-8 12-10l8-2 6-8 10 4 4-4 8 6v8c0 2-2 4-4 4H12c-2 0-4-2-4-4z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path
                d="M20 32l4 6M28 30l2 8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <span className="text-xs">No image</span>
          </div>
        )}
        {/*
          Badge: rounded-full + ring-1 for crispness on photos.
          "In stock" uses brand.green (#1F7A52) instead of generic green-600.
          Other badges use brand-palette classes via label.className.
        */}
        <span
          className={`absolute top-2 left-2 text-[10px] uppercase tracking-wider px-2 py-1 rounded-full ring-1 ring-black/5 ${label.className}`}
        >
          {label.text}
          {label.textAm && (
            <>
              {" · "}
              <span
                lang="am"
                style={{
                  fontFamily:
                    "var(--font-ethiopic), 'Abyssinica SIL', 'Nyala', sans-serif",
                }}
              >
                {label.textAm}
              </span>
            </>
          )}
        </span>
      </div>
      <div className="p-3 flex-1 flex flex-col gap-2">
        <div>
          {shoe.brand && (
            <div className="text-[11px] uppercase tracking-wider text-neutral-500">
              {shoe.brand}
            </div>
          )}
          <div className="text-sm font-medium line-clamp-2 min-h-[2.5rem]">
            {shoe.title}
          </div>
        </div>

        {/*
          Size availability strip — display-only, NOT interactive.
          Phase 1: driven by shoe_sizes rows (per-size logistics status).
          Falls back to free-text parsing if shoe_sizes is absent or empty
          (pre-migration shoes or shoes not yet given sizes in the editor).
        */}
        <SizeStrip
          shoeSizes={shoe.shoe_sizes}
          sizesText={shoe.sizes}
          inStock={shoe.status === "available"}
        />

        {mode === "info" && (
          <ul className="text-xs space-y-1.5 border-t border-neutral-100 pt-2">
            {/* Producer site is admin-only — it's the procurement source and
                the whole funnel exists to gate access to it. */}
            {isAdmin && (
              <li>
                <a
                  href={shoe.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-blue-700 hover:underline"
                >
                  Producer site →
                </a>
              </li>
            )}
            <li className="text-neutral-700">
              {shoe.price_usd != null
                ? `$${shoe.price_usd}`
                : "Price unavailable"}
            </li>
            <li>
              <a
                href={reviewsUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-blue-700 hover:underline"
              >
                Reviews →
              </a>
            </li>
          </ul>
        )}

        {mode === "request" && (
          <div className="space-y-2 border-t border-neutral-100 pt-2">
            <input
              type="text"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="Size (optional)"
              className="w-full border border-neutral-300 rounded px-2 py-1 text-xs"
            />
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="w-full border border-neutral-300 rounded px-2 py-1 text-xs"
            />
            {err && <div className="text-xs text-red-600">{err}</div>}
            <div className="flex gap-1">
              <button
                type="button"
                onClick={send}
                disabled={loading}
                className="flex-1 text-xs rounded-lg px-2 py-2.5 disabled:opacity-50 text-white bg-brand-espresso hover:bg-brand-coffee focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-amber transition-colors"
              >
                {loading ? "Sending..." : "Send request"}
              </button>
              <button
                type="button"
                onClick={() => setMode("idle")}
                disabled={loading}
                className="text-xs border border-neutral-300 rounded-lg px-2 py-2.5"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/*
          Action buttons row — items-stretch ensures equal height so the Amharic
          CTA glyph (taller than Latin at the same font size) and the "Info" button
          stay the same height. py-2.5 min gives ~44 px tap targets on mobile.
        */}
        <div className="mt-auto flex items-stretch gap-2 pt-1">
          <button
            type="button"
            onClick={() => setMode(mode === "info" ? "idle" : "info")}
            className="flex-1 text-xs border border-neutral-300 rounded-lg px-2 py-2.5 hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-amber"
          >
            {mode === "info" ? "Hide info" : "Info"}
          </button>
          {alreadyRequested && shoe.status !== "sold" && (
            <div className="flex-1 text-xs text-center text-neutral-500 border border-neutral-200 rounded-lg px-2 py-2.5">
              Requested
            </div>
          )}
          {canShowRequest && mode !== "request" && (
            /*
              Reserve CTA — primary brand button.
              Amharic: "ይያዙ" = "reserve / hold" (confirmed by owner).
              Hover state uses Tailwind brand tokens (bg-brand-espresso hover:bg-brand-coffee)
              so keyboard :focus-visible works correctly.
            */
            <button
              type="button"
              onClick={() => setMode("request")}
              className="flex-1 text-xs rounded-lg px-2 py-2.5 text-white font-medium bg-brand-espresso hover:bg-brand-coffee focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-amber transition-colors"
              aria-label="Reserve"
              title="Reserve / ይያዙ"
            >
              <span
                lang="am"
                style={{ fontFamily: "var(--font-ethiopic), 'Abyssinica SIL', 'Nyala', sans-serif", lineHeight: 1.4 }}
              >
                ይያዙ
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SizeStrip — display-only size availability grid
// ---------------------------------------------------------------------------

/**
 * Renders a compact, wrapping row of size chips (US primary, EU secondary).
 *
 * Phase 1: driven by shoe_sizes rows (per-size logistics status).
 * Each chip reflects the customer state derived from that size's logistics status:
 *   - in-stock    → solid green chip (arrived)
 *   - on-the-way  → gold accent chip (purchased)
 *   - coming-soon → muted neutral chip (in_cart or null)
 *   - sold-out    → greyed + line-through + aria-label "sold out" (delivered or absent)
 *
 * Falls back to free-text parseAvailableSizes if shoe_sizes is absent / empty
 * (shows all listed sizes as coming-soon, absent ones as sold-out).
 *
 * Empty / no parseable sizes → "Sizes TBA / መጠን በቅርቡ" (or omit if no sizes field).
 *
 * NOT interactive — do not add click handlers here.
 */
function SizeStrip({
  shoeSizes,
  sizesText,
  inStock = false,
}: {
  shoeSizes: ShoeSize[] | undefined;
  sizesText: string | null;
  /**
   * True when the shoe's sales status is "available" — i.e. the whole item is
   * in stock now. In that case listed sizes render as in-stock (green) rather
   * than greyed/coming-soon, keeping the chips consistent with the "In stock"
   * badge. Per-size logistics granularity is preserved for upcoming shoes.
   */
  inStock?: boolean;
}) {
  // Prefer per-size DB rows when available.
  const hasSizeRows = shoeSizes && shoeSizes.length > 0;

  if (hasSizeRows) {
    const grid = sizeGridFromSizes(shoeSizes!);

    // If every size is sold-out (delivered + absent) and there are no listed
    // coming-soon/on-the-way/in-stock, it still makes sense to show the grid —
    // it tells the customer which sizes were offered (and are now gone).
    // Only omit the strip if shoe_sizes itself is empty (handled above).

    return (
      <div className="border-t border-neutral-100 pt-2">
        {/* Label row — bilingual, subtle */}
        <p
          className="text-[9px] uppercase tracking-wider text-neutral-400 mb-1.5 leading-none"
          aria-hidden="true"
        >
          Sizes ·{" "}
          <span
            lang="am"
            style={{
              fontFamily:
                "var(--font-ethiopic), 'Abyssinica SIL', 'Nyala', sans-serif",
            }}
          >
            መጠን
          </span>
        </p>

        {/*
          Chip grid — uses flex-wrap so chips reflow on narrow (2-up phone) cards.
          Compact sizing: text-[11px] + px-1.5 py-0.5 keeps chips tidy while
          remaining legible; 13 chips across a 160px card wrap to ≤3 rows.
        */}
        <div
          className="flex flex-wrap gap-0.5"
          role="list"
          aria-label="Size availability"
        >
          {grid.map((entry) => {
            const rawState = entry.customerState ?? "sold-out";
            // When the shoe is in stock (sales status "available"), promote its
            // listed sizes to in-stock so they don't render greyed/coming-soon.
            // Genuinely sold-out sizes (delivered/absent) stay sold-out.
            const state =
              inStock && entry.available && rawState !== "sold-out"
                ? "in-stock"
                : rawState;
            const isSoldOut = !entry.available || state === "sold-out";
            const ariaLabel = isSoldOut
              ? `US ${entry.us} / EU ${entry.eu} — sold out`
              : state === "in-stock"
              ? `US ${entry.us} / EU ${entry.eu} — in stock`
              : state === "on-the-way"
              ? `US ${entry.us} / EU ${entry.eu} — on the way`
              : `US ${entry.us} / EU ${entry.eu}`;

            // Chip background: per-state colour
            const chipBg = isSoldOut
              ? "bg-neutral-50 text-neutral-400"
              : state === "in-stock"
              ? "bg-[#1F7A52] text-white"
              : state === "on-the-way"
              ? "bg-[#E8B53A] text-neutral-900"
              : "bg-neutral-100 text-neutral-700"; // coming-soon

            return (
              <span
                key={entry.us}
                role="listitem"
                title={ariaLabel}
                aria-label={ariaLabel}
                className={[
                  "inline-flex flex-col items-center leading-none rounded px-1.5 py-0.5",
                  chipBg,
                ].join(" ")}
              >
                <span
                  className={[
                    "text-[11px] font-medium",
                    isSoldOut ? "line-through" : "",
                  ].join(" ")}
                >
                  {entry.us}
                </span>
                <span
                  className={[
                    "text-[9px] leading-none mt-px",
                    isSoldOut
                      ? "text-neutral-300"
                      : state === "in-stock"
                      ? "text-white/80"
                      : state === "on-the-way"
                      ? "text-neutral-700"
                      : "text-neutral-500",
                  ].join(" ")}
                >
                  {entry.eu}
                </span>
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  // Fallback: no shoe_sizes rows yet — use free-text field.
  const hasUsableSizes = parseAvailableSizes(sizesText).size > 0;

  if (!hasUsableSizes) {
    if (!sizesText || !sizesText.trim()) {
      // No sizes field at all — silently omit the strip.
      return null;
    }
    // sizes field present but nothing mapped to grid — show TBA.
    return (
      <div className="border-t border-neutral-100 pt-2">
        <p
          className="text-[10px] text-neutral-400 italic"
          aria-label="Size availability not yet specified"
        >
          Sizes TBA ·{" "}
          <span
            lang="am"
            style={{
              fontFamily:
                "var(--font-ethiopic), 'Abyssinica SIL', 'Nyala', sans-serif",
            }}
          >
            መጠን በቅርቡ
          </span>
        </p>
      </div>
    );
  }

  // Legacy fallback: free-text sizes, no per-size status yet.
  // Render as "coming-soon" for listed sizes, sold-out for others.
  const grid = sizeGridFromSizes([]); // all sold-out baseline
  const available = parseAvailableSizes(sizesText);

  return (
    <div className="border-t border-neutral-100 pt-2">
      <p
        className="text-[9px] uppercase tracking-wider text-neutral-400 mb-1.5 leading-none"
        aria-hidden="true"
      >
        Sizes ·{" "}
        <span
          lang="am"
          style={{
            fontFamily:
              "var(--font-ethiopic), 'Abyssinica SIL', 'Nyala', sans-serif",
          }}
        >
          መጠን
        </span>
      </p>
      <div
        className="flex flex-wrap gap-0.5"
        role="list"
        aria-label="Size availability"
      >
        {grid.map((entry) => {
          const isAvailable = available.has(entry.us);
          // When the shoe is in stock, listed sizes render in-stock (green)
          // instead of greyed/neutral — consistent with the "In stock" badge.
          const showInStock = inStock && isAvailable;
          const ariaLabel = !isAvailable
            ? `US ${entry.us} / EU ${entry.eu} — sold out`
            : showInStock
            ? `US ${entry.us} / EU ${entry.eu} — in stock`
            : `US ${entry.us} / EU ${entry.eu}`;
          return (
            <span
              key={entry.us}
              role="listitem"
              title={ariaLabel}
              aria-label={ariaLabel}
              className={[
                "inline-flex flex-col items-center leading-none rounded px-1.5 py-0.5",
                showInStock
                  ? "bg-[#1F7A52] text-white"
                  : isAvailable
                  ? "bg-neutral-100 text-neutral-700"
                  : "bg-neutral-50 text-neutral-400",
              ].join(" ")}
            >
              <span
                className={[
                  "text-[11px] font-medium",
                  isAvailable ? "" : "line-through",
                ].join(" ")}
              >
                {entry.us}
              </span>
              <span
                className={[
                  "text-[9px] leading-none mt-px",
                  showInStock
                    ? "text-white/80"
                    : isAvailable
                    ? "text-neutral-500"
                    : "text-neutral-300",
                ].join(" ")}
              >
                {entry.eu}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
