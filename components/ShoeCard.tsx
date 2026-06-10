"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Shoe, ShoeSize } from "@/lib/supabase";
import { customerLabel } from "@/lib/labels";
import { sizeGridFromSizes, sizeGrid } from "@/lib/sizes";
import { categoryFromTitle } from "@/components/shoe-category";

type Mode = "idle" | "request";

const ETHIOPIC_FONT =
  "var(--font-ethiopic), 'Abyssinica SIL', 'Nyala', sans-serif";

/** "18500" → "ብር 18,500" (no USD anywhere in customer UI). */
function formatEtb(priceEtb: number): string {
  return `ብር ${Number(priceEtb).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The US sizes a customer can still get (or vote for): shoe_sizes rows that
 * aren't sold-out, in SIZE_GRID order; legacy free-text fallback when no rows.
 */
function listedUsSizes(shoeSizes: ShoeSize[] | undefined, sizesText: string | null): string[] {
  if (shoeSizes && shoeSizes.length > 0) {
    return sizeGridFromSizes(shoeSizes)
      .filter((e) => e.available && e.customerState !== "sold-out")
      .map((e) => e.us);
  }
  return sizeGrid(sizesText)
    .filter((e) => e.available)
    .map((e) => e.us);
}

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
  // Hands-on video: tapping the play tile swaps the image for a <video>.
  const [showVideo, setShowVideo] = useState(false);

  const section = customerLabel(shoe).section;
  const isComingSoon = section === "coming-soon";
  const canShowRequest =
    shoe.status !== "sold" && signedIn && !alreadyRequested;

  // GENERAL category on the card; full model name lives on /shoe/[id].
  const category = categoryFromTitle(shoe.title);
  const sizes = listedUsSizes(shoe.shoe_sizes, shoe.sizes);

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

  // Status pill — mockup palette (NEVER "In Addis"; no internal pipeline labels).
  const pill =
    section === "in-stock"
      ? { text: "● In stock", className: "bg-[#e3f6ec] text-[#137044]" }
      : section === "on-the-way"
      ? { text: "✈ On the way", className: "bg-[#fff1e6] text-accent-deep" }
      : section === "previously"
      ? { text: "Sold", className: "bg-neutral-200 text-neutral-600" }
      : { text: "Coming soon", className: "bg-[#eee9df] text-[#6b6354]" };

  return (
    <div
      className={`group bg-paper border border-line rounded-[20px] overflow-hidden flex flex-col transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-[0_24px_48px_rgba(30,25,15,0.13)] ${
        dim ? "opacity-60" : ""
      }`}
    >
      {/* Image-first media box: warm radial backdrop, product shot blended in */}
      <div
        className="relative overflow-hidden flex items-center justify-center"
        style={{
          aspectRatio: "1 / 1.02",
          background:
            "radial-gradient(circle at 50% 38%, #ffffff 0%, #efe9dc 100%)",
        }}
      >
        {showVideo && shoe.video_url ? (
          <>
            {/*
              Hands-on video of the actual pair (video_url, migration 0012) —
              rendered only on demand so the card stays light by default.
            */}
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={shoe.video_url}
              controls
              playsInline
              preload="metadata"
              className="absolute inset-0 w-full h-full object-contain bg-ink"
            />
            <button
              type="button"
              onClick={() => setShowVideo(false)}
              aria-label="Close video"
              className="absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-ink/80 text-cream text-sm font-bold flex items-center justify-center hover:bg-ink"
            >
              ✕
            </button>
          </>
        ) : shoe.image_url && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shoe.image_url}
            alt={shoe.title}
            className="w-[94%] max-h-full object-contain mix-blend-multiply group-hover:scale-105 transition-transform duration-300"
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

        {!showVideo && (
          <span
            className={`absolute top-3.5 left-3.5 text-[10.5px] font-extrabold uppercase tracking-[0.1em] px-3 py-1.5 rounded-full ${pill.className}`}
          >
            {pill.text}
          </span>
        )}

        {/* Play tile — ONLY when a hands-on video exists for this pair. */}
        {shoe.video_url && !showVideo && (
          <button
            type="button"
            onClick={() => setShowVideo(true)}
            className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-ink text-cream text-[11px] font-bold rounded-[9px] px-2.5 py-2 shadow-md hover:bg-accent-deep transition-colors"
            aria-label="Watch hands-on video"
          >
            <span aria-hidden="true">▶</span> Video
          </button>
        )}
      </div>

      <div className="p-[18px] pb-5 flex-1 flex flex-col gap-3">
        <div>
          {shoe.brand && (
            <div className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-muted">
              {shoe.brand}
            </div>
          )}
          {/* General category only — full model name on the details page. */}
          <h3
            className="text-base font-extrabold leading-snug truncate mt-0.5"
            title={category}
          >
            {category}
          </h3>
        </div>

        {/* Meta row: admin-set birr price when set, otherwise contact link.
            NO USD prices ever (price_usd is stripped server-side for non-admins). */}
        <div className="flex items-center justify-between gap-2">
          {shoe.price_etb != null ? (
            <div className="font-display text-[15px] font-bold">
              {formatEtb(shoe.price_etb)}
            </div>
          ) : (
            <Link
              href="/#visit"
              className="text-[11.5px] font-extrabold border-[1.5px] border-line hover:border-ink rounded-full px-3 py-1.5 bg-cream whitespace-nowrap"
            >
              ☎ Contact for price
            </Link>
          )}
          <Link
            href={`/shoe/${shoe.id}`}
            className="text-[12.5px] font-bold text-accent-deep hover:underline whitespace-nowrap"
          >
            Details ↗
          </Link>
        </div>

        {/* Sizes — only listed (not sold-out) sizes as chips. Coming-soon pairs
            get the explicit "Coming in US" treatment from the mockup. */}
        {sizes.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted mr-0.5">
              {isComingSoon ? "Coming in US" : "US"}
            </span>
            {sizes.map((us) => (
              <span
                key={us}
                className={
                  isComingSoon
                    ? "text-xs font-bold border-[1.5px] border-accent-deep/45 text-accent-deep bg-[#fff4ea] rounded-lg px-2 py-1"
                    : "text-xs font-bold border-[1.5px] border-line text-[#4d493f] bg-cream rounded-lg px-2 py-1"
                }
              >
                {us}
              </span>
            ))}
          </div>
        ) : shoe.sizes && shoe.sizes.trim() ? (
          <p className="text-[11px] text-muted italic">
            Sizes TBA ·{" "}
            <span lang="am" style={{ fontFamily: ETHIOPIC_FONT }}>
              መጠን በቅርቡ
            </span>
          </p>
        ) : null}

        {/* Admin-only: procurement source. shoe.url is blanked server-side for
            everyone else (redactForViewer), this gate is belt-and-braces. */}
        {isAdmin && shoe.url && (
          <a
            href={shoe.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[11px] text-blue-700 hover:underline w-fit"
          >
            Producer site → (admin)
          </a>
        )}

        {mode === "request" && (
          <div className="space-y-2 border-t border-line pt-2.5">
            <input
              type="text"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="Size (optional)"
              className="w-full border border-line bg-paper rounded-lg px-2.5 py-1.5 text-xs"
            />
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="w-full border border-line bg-paper rounded-lg px-2.5 py-1.5 text-xs"
            />
            {err && <div className="text-xs text-red-600">{err}</div>}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={send}
                disabled={loading}
                className="flex-1 text-[13px] font-extrabold rounded-xl px-2 py-2.5 disabled:opacity-50 text-cream bg-ink hover:bg-accent-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent transition-colors"
              >
                {loading ? "Sending..." : "Send request"}
              </button>
              <button
                type="button"
                onClick={() => setMode("idle")}
                disabled={loading}
                className="text-xs font-bold border-[1.5px] border-line rounded-xl px-3 py-2.5 hover:border-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* CTA row */}
        <div className="mt-auto flex items-stretch gap-2 pt-1">
          {alreadyRequested && shoe.status !== "sold" && (
            <div className="flex-1 text-[13px] font-bold text-center text-accent-green border-[1.5px] border-accent-green/40 bg-[#e3f6ec] rounded-xl px-2 py-2.5">
              Requested ✓
            </div>
          )}
          {canShowRequest && mode !== "request" && (
            /*
              Interest CTA — same wiring as before (POST /api/interests then
              router.refresh()). Mockup copy: solid ink "I want this · እፈልጋለሁ"
              ("Reserve my size" for on-the-way pairs), outlined variant for
              coming-soon ("vote with I want this").
            */
            <button
              type="button"
              onClick={() => setMode("request")}
              className={`flex-1 flex items-center justify-center gap-1.5 text-[13.5px] font-extrabold rounded-xl px-2 py-3 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                isComingSoon
                  ? "border-[1.5px] border-ink text-ink hover:bg-ink hover:text-cream"
                  : "bg-ink text-cream hover:bg-accent-deep"
              }`}
              title="I want this / እፈልጋለሁ"
            >
              {section === "on-the-way" ? (
                "Reserve my size"
              ) : (
                <>
                  I want this ·{" "}
                  <span
                    lang="am"
                    style={{ fontFamily: ETHIOPIC_FONT, lineHeight: 1.4 }}
                  >
                    እፈልጋለሁ
                  </span>
                </>
              )}
            </button>
          )}
          {!signedIn && shoe.status !== "sold" && (
            <Link
              href="/auth/sign-in"
              className="flex-1 text-center text-[13px] font-bold border-[1.5px] border-line text-muted rounded-xl px-2 py-3 hover:border-ink hover:text-ink transition-colors"
            >
              Sign in to reserve
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
