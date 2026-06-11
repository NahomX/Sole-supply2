"use client";

import { useState } from "react";

/**
 * Resilient product image for server pages (hero + details).
 *
 * Deliberately a plain <img> with an onError fallback instead of next/image:
 * product images come from arbitrary retailer CDNs (the scraper accepts any
 * URL), so load errors are expected — the fallback is the resilience
 * mechanism, mirroring ShoeCard's behaviour.
 *
 * fallback="hide"        → render nothing on error/missing src (hero shot)
 * fallback="placeholder" → render the sneaker-outline empty state (details)
 */
export function ShoeImage({
  src,
  alt,
  className = "",
  fallback = "placeholder",
}: {
  src: string | null;
  alt: string;
  className?: string;
  fallback?: "placeholder" | "hide";
}) {
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    if (fallback === "hide") return null;
    return (
      <div className="flex flex-col items-center justify-center gap-1 text-neutral-400 py-16">
        <svg
          aria-hidden="true"
          width="48"
          height="48"
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
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setErrored(true)}
    />
  );
}
