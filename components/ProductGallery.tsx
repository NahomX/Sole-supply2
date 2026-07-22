"use client";

import { useState, useMemo } from "react";
import type { ShoeImage, ShoeVariant, ShoeImageViewType } from "@/lib/supabase";

/** Human-readable labels for each view type, in display order. */
const VIEW_TYPE_ORDER: ShoeImageViewType[] = [
  "hero",
  "zoom",
  "side",
  "top",
  "back",
  "sole",
  "lifestyle",
];

const VIEW_TYPE_LABELS: Record<ShoeImageViewType, string> = {
  hero: "Hero",
  zoom: "Close-up",
  side: "Side",
  top: "Top",
  back: "Back",
  sole: "Sole",
  lifestyle: "Lifestyle",
};

type Props = {
  /** The fallback single image from shoes.image_url. */
  fallbackImageUrl: string | null;
  /** All images for this shoe (from shoe_images table). */
  images: ShoeImage[];
  /** All color variants (from shoe_variants table). */
  variants: ShoeVariant[];
  /** Shoe title for alt text. */
  title: string;
  /** Status pill to overlay on the main image. */
  statusPill?: { text: string; className: string };
};

export function ProductGallery({
  fallbackImageUrl,
  images,
  variants,
  title,
  statusPill,
}: Props) {
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [mainImageUrl, setMainImageUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  // Sort variants by sort_order.
  const sortedVariants = useMemo(
    () => [...variants].sort((a, b) => a.sort_order - b.sort_order),
    [variants]
  );

  // Build the gallery images for the currently selected variant.
  // Images with variant_id === null apply to all variants (base images).
  // Images with a specific variant_id apply only to that variant.
  const galleryImages = useMemo(() => {
    const baseImages = images.filter((img) => img.variant_id === null);
    const variantImages = selectedVariantId
      ? images.filter((img) => img.variant_id === selectedVariantId)
      : [];

    // Merge: variant-specific images override base images for the same view_type.
    const byViewType = new Map<ShoeImageViewType, ShoeImage>();
    for (const img of baseImages) {
      byViewType.set(img.view_type, img);
    }
    for (const img of variantImages) {
      byViewType.set(img.view_type, img);
    }

    // Sort by the canonical view type order.
    return VIEW_TYPE_ORDER.filter((vt) => byViewType.has(vt)).map(
      (vt) => byViewType.get(vt)!
    );
  }, [images, selectedVariantId]);

  // The image to show in the main area.
  const hasGallery = galleryImages.length > 0;
  const effectiveMainUrl =
    mainImageUrl ?? (hasGallery ? galleryImages[0].url : fallbackImageUrl);

  // When variant changes, reset the main image to the first image of that variant.
  function handleVariantSelect(variantId: string | null) {
    setSelectedVariantId(variantId);
    setMainImageUrl(null);
    setImgError(false);
  }

  return (
    <div>
      {/* Main image container */}
      <div
        className="relative border border-th-border rounded-[24px] overflow-hidden flex items-center justify-center"
        style={{
          aspectRatio: "1 / 1",
          background:
            "radial-gradient(circle at 50% 38%, #1a1a1a 0%, #111111 100%)",
        }}
      >
        {effectiveMainUrl && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={effectiveMainUrl}
            alt={title}
            className="w-[92%] max-h-full object-contain"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-1 text-th-muted py-16">
            <svg
              aria-hidden="true"
              width="48"
              height="48"
              viewBox="0 0 64 64"
              fill="none"
              className="text-th-muted/50"
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

        {statusPill && (
          <span
            className={`absolute top-4 left-4 text-[10.5px] font-extrabold uppercase tracking-[0.1em] px-3 py-1.5 rounded-full ${statusPill.className}`}
          >
            {statusPill.text}
          </span>
        )}
      </div>

      {/* Thumbnail strip — shown when there are multiple gallery images */}
      {hasGallery && galleryImages.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {galleryImages.map((img) => {
            const isActive = effectiveMainUrl === img.url;
            return (
              <button
                key={img.id}
                type="button"
                onClick={() => {
                  setMainImageUrl(img.url);
                  setImgError(false);
                }}
                className={`flex-shrink-0 w-16 h-16 rounded-xl border-2 overflow-hidden transition-all ${
                  isActive
                    ? "border-accent ring-1 ring-accent/40"
                    : "border-th-border hover:border-white/30"
                }`}
                title={VIEW_TYPE_LABELS[img.view_type]}
                style={{
                  background:
                    "radial-gradient(circle, #1a1a1a 0%, #111111 100%)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={`${title} — ${VIEW_TYPE_LABELS[img.view_type]}`}
                  className="w-full h-full object-contain"
                />
              </button>
            );
          })}
        </div>
      )}

      {/* Color swatches — shown when there are variants */}
      {sortedVariants.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-th-muted mb-2">
            Color
          </p>
          <div className="flex flex-wrap gap-2">
            {sortedVariants.map((v) => {
              const isSelected = selectedVariantId === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() =>
                    handleVariantSelect(isSelected ? null : v.id)
                  }
                  className={`group flex items-center gap-2 rounded-full border-2 px-3 py-1.5 transition-all ${
                    isSelected
                      ? "border-accent bg-accent/10"
                      : "border-th-border hover:border-white/40 bg-surface-2"
                  }`}
                  title={v.color_name}
                >
                  {/* Swatch circle */}
                  {v.swatch_hex ? (
                    <span
                      className={`w-5 h-5 rounded-full border ${
                        isSelected ? "border-accent" : "border-th-border"
                      }`}
                      style={{ backgroundColor: v.swatch_hex }}
                    />
                  ) : v.swatch_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={v.swatch_image_url}
                      alt=""
                      className={`w-5 h-5 rounded-full border object-cover ${
                        isSelected ? "border-accent" : "border-th-border"
                      }`}
                    />
                  ) : (
                    <span
                      className={`w-5 h-5 rounded-full border bg-surface ${
                        isSelected ? "border-accent" : "border-th-border"
                      }`}
                    />
                  )}
                  <span
                    className={`text-xs font-semibold ${
                      isSelected ? "text-accent" : "text-th-muted group-hover:text-white"
                    }`}
                  >
                    {v.color_name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
