"use client";

import { useState } from "react";
import type { ShoeVariant, ShoeImage, ShoeImageViewType } from "@/lib/supabase";

const VIEW_TYPES: ShoeImageViewType[] = [
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
  shoeId: string;
  variants: ShoeVariant[];
  images: ShoeImage[];
  onRefresh: () => void;
};

export function AdminMediaManager({
  shoeId,
  variants,
  images,
  onRefresh,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Variant form
  const [variantName, setVariantName] = useState("");
  const [variantHex, setVariantHex] = useState("#000000");

  // Image form
  const [imageUrl, setImageUrl] = useState("");
  const [imageViewType, setImageViewType] = useState<ShoeImageViewType>("hero");
  const [imageVariantId, setImageVariantId] = useState<string>("");

  async function apiCall(
    path: string,
    init: RequestInit
  ): Promise<boolean> {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(path, init);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMsg(j.error ?? "Request failed.");
        return false;
      }
      onRefresh();
      return true;
    } catch {
      setMsg("Network error.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function addVariant() {
    if (!variantName.trim()) return;
    const ok = await apiCall(`/api/shoes/${shoeId}/variants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        color_name: variantName.trim(),
        swatch_hex: variantHex || null,
        sort_order: variants.length,
      }),
    });
    if (ok) {
      setVariantName("");
      setVariantHex("#000000");
    }
  }

  async function deleteVariant(variantId: string) {
    if (!confirm("Delete this color variant and its images?")) return;
    await apiCall(
      `/api/shoes/${shoeId}/variants?variant_id=${encodeURIComponent(variantId)}`,
      { method: "DELETE" }
    );
  }

  async function addImage() {
    if (!imageUrl.trim()) return;
    const ok = await apiCall(`/api/shoes/${shoeId}/images`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: imageUrl.trim(),
        view_type: imageViewType,
        variant_id: imageVariantId || null,
        sort_order: images.length,
      }),
    });
    if (ok) {
      setImageUrl("");
    }
  }

  async function deleteImage(imageId: string) {
    if (!confirm("Delete this image?")) return;
    await apiCall(
      `/api/shoes/${shoeId}/images?image_id=${encodeURIComponent(imageId)}`,
      { method: "DELETE" }
    );
  }

  return (
    <div className="border-t border-neutral-100 pt-3 mt-1">
      <button
        type="button"
        onClick={() => setExpanded((o) => !o)}
        className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-neutral-500 hover:text-neutral-700"
        aria-expanded={expanded}
      >
        <span>Images &amp; Variants</span>
        <span className="text-neutral-400 ml-1">
          ({images.length} img, {variants.length} color{variants.length !== 1 ? "s" : ""})
        </span>
        <span className="ml-1 text-neutral-400">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-4">
          {msg && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
              {msg}
            </div>
          )}

          {/* ---- Color Variants ---- */}
          <div>
            <h4 className="text-xs font-semibold text-neutral-700 mb-2">
              Color Variants
            </h4>

            {variants.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {variants.map((v) => (
                  <div
                    key={v.id}
                    className="inline-flex items-center gap-1.5 border border-neutral-200 rounded-full px-2.5 py-1 bg-white"
                  >
                    {v.swatch_hex && (
                      <span
                        className="w-4 h-4 rounded-full border border-neutral-300"
                        style={{ backgroundColor: v.swatch_hex }}
                      />
                    )}
                    <span className="text-xs font-medium text-neutral-700">
                      {v.color_name}
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteVariant(v.id)}
                      disabled={loading}
                      className="text-[9px] text-red-400 hover:text-red-600 ml-0.5"
                      title="Delete variant"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="text-[10px] text-neutral-500 block">
                  Color name
                </label>
                <input
                  type="text"
                  value={variantName}
                  onChange={(e) => setVariantName(e.target.value)}
                  placeholder="e.g. Midnight Black"
                  disabled={loading}
                  className="border border-neutral-300 rounded px-2 py-1 text-xs w-36"
                />
              </div>
              <div>
                <label className="text-[10px] text-neutral-500 block">
                  Swatch
                </label>
                <input
                  type="color"
                  value={variantHex}
                  onChange={(e) => setVariantHex(e.target.value)}
                  disabled={loading}
                  className="w-8 h-7 rounded border border-neutral-300 cursor-pointer"
                />
              </div>
              <button
                type="button"
                onClick={addVariant}
                disabled={loading || !variantName.trim()}
                className="text-xs border border-neutral-300 rounded px-2.5 py-1 hover:bg-neutral-50 disabled:opacity-50"
              >
                + Add color
              </button>
            </div>
          </div>

          {/* ---- Images ---- */}
          <div>
            <h4 className="text-xs font-semibold text-neutral-700 mb-2">
              Image Gallery
            </h4>

            {images.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mb-3">
                {images.map((img) => {
                  const variant = variants.find((v) => v.id === img.variant_id);
                  return (
                    <div
                      key={img.id}
                      className="relative border border-neutral-200 rounded overflow-hidden bg-neutral-50 group"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.url}
                        alt={VIEW_TYPE_LABELS[img.view_type]}
                        className="w-full h-20 object-contain"
                      />
                      <div className="px-1.5 py-1 flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-semibold text-neutral-500 uppercase">
                            {VIEW_TYPE_LABELS[img.view_type]}
                          </span>
                          {variant && (
                            <span className="text-[8px] text-neutral-400">
                              ({variant.color_name})
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteImage(img.id)}
                          disabled={loading}
                          className="text-[9px] text-red-400 hover:text-red-600"
                          title="Delete image"
                        >
                          x
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[200px]">
                <label className="text-[10px] text-neutral-500 block">
                  Image URL
                </label>
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://..."
                  disabled={loading}
                  className="w-full border border-neutral-300 rounded px-2 py-1 text-xs"
                />
              </div>
              <div>
                <label className="text-[10px] text-neutral-500 block">
                  View type
                </label>
                <select
                  value={imageViewType}
                  onChange={(e) =>
                    setImageViewType(e.target.value as ShoeImageViewType)
                  }
                  disabled={loading}
                  className="border border-neutral-300 rounded px-2 py-1 text-xs"
                >
                  {VIEW_TYPES.map((vt) => (
                    <option key={vt} value={vt}>
                      {VIEW_TYPE_LABELS[vt]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-neutral-500 block">
                  Color (optional)
                </label>
                <select
                  value={imageVariantId}
                  onChange={(e) => setImageVariantId(e.target.value)}
                  disabled={loading}
                  className="border border-neutral-300 rounded px-2 py-1 text-xs"
                >
                  <option value="">All / base</option>
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.color_name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={addImage}
                disabled={loading || !imageUrl.trim()}
                className="text-xs border border-neutral-300 rounded px-2.5 py-1 hover:bg-neutral-50 disabled:opacity-50"
              >
                + Add image
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
