"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Shoe } from "@/lib/supabase";
import { customerLabel } from "@/lib/labels";

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
        {shoe.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shoe.image_url}
            alt={shoe.title}
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-neutral-400 text-sm">
            No image
          </div>
        )}
        {/*
          Badge: rounded-full + ring-1 for crispness on photos.
          "In stock" uses brand.green (#1F7A52) instead of generic green-600.
          Other badges keep semantic colours but are softened via label.className.
        */}
        <span
          className={`absolute top-2 left-2 text-[10px] uppercase tracking-wider px-2 py-1 rounded-full ring-1 ring-black/5 ${label.className}`}
        >
          {label.text}
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
                className="flex-1 text-xs rounded-lg px-2 py-1 disabled:opacity-50 text-white"
                style={{ backgroundColor: "#2A1A12" }}
                onMouseOver={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#3E2A1C"; }}
                onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#2A1A12"; }}
              >
                {loading ? "Sending..." : "Send request"}
              </button>
              <button
                type="button"
                onClick={() => setMode("idle")}
                disabled={loading}
                className="text-xs border border-neutral-300 rounded-lg px-2 py-1"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mt-auto flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => setMode(mode === "info" ? "idle" : "info")}
            className="flex-1 text-xs border border-neutral-300 rounded-lg px-2 py-1.5 hover:bg-neutral-50"
          >
            {mode === "info" ? "Hide info" : "Info"}
          </button>
          {alreadyRequested && shoe.status !== "sold" && (
            <div className="flex-1 text-xs text-center text-neutral-500 border border-neutral-200 rounded-lg px-2 py-1.5">
              Requested
            </div>
          )}
          {canShowRequest && mode !== "request" && (
            /*
              "I want this" CTA — primary brand button.
              Amharic: "ይሄን እፈልጋለሁ" (best-effort; owner must verify before launch)
              Shows Amharic text as primary with English as secondary/aria label for
              screen readers, keeping the button width flexible (Amharic glyphs differ
              in render width from English). Inline style used for brand color since
              brand.espresso is a custom token not available as a Tailwind class
              without JIT purge of the dynamic className variant.
            */
            <button
              type="button"
              onClick={() => setMode("request")}
              className="flex-1 text-xs rounded-lg px-2 py-1.5 text-white font-medium"
              style={{ backgroundColor: "#2A1A12" }}
              onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#3E2A1C"; }}
              onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#2A1A12"; }}
              aria-label="I want this"
              title="I want this / ይሄን እፈልጋለሁ"
            >
              {/* Amharic primary — NOTE: owner must verify spelling before launch */}
              <span lang="am" style={{ fontFamily: "'Noto Sans Ethiopic', 'Abyssinica SIL', 'Nyala', sans-serif", lineHeight: 1.4 }}>
                ይሄን እፈልጋለሁ
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
