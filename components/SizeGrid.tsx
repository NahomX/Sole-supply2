"use client";

import { useState } from "react";
import type { SizeGridEntry } from "@/lib/sizes";

const ETHIOPIC_FONT =
  "var(--font-ethiopic), 'Abyssinica SIL', 'Nyala', sans-serif";

type Props = {
  entries: SizeGridEntry[];
  isComingSoon: boolean;
  /** Callback when a size is selected. */
  onSelect?: (us: string | null) => void;
};

export function SizeGrid({ entries, isComingSoon, onSelect }: Props) {
  const [selectedSize, setSelectedSize] = useState<string | null>(null);

  function handleTap(us: string, customerState: string | undefined) {
    if (customerState === "sold-out") return;
    const next = selectedSize === us ? null : us;
    setSelectedSize(next);
    onSelect?.(next);
  }

  if (entries.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-th-muted mb-2.5">
        {isComingSoon ? "Coming in US sizes" : "US sizes"} ·{" "}
        <span
          lang="am"
          className="normal-case tracking-normal"
          style={{ fontFamily: ETHIOPIC_FONT }}
        >
          መጠን
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        {entries.map((e) => {
          const state = e.customerState ?? "coming-soon";
          const isSoldOut = state === "sold-out";
          const isActive = selectedSize === e.us;

          let chipStyle: string;
          if (isActive) {
            chipStyle =
              "border-accent bg-accent/20 text-accent ring-1 ring-accent/40";
          } else if (state === "in-stock") {
            chipStyle = "border-emerald-500/40 bg-emerald-900/30 text-emerald-400";
          } else if (state === "on-the-way") {
            chipStyle = "border-amber-500/40 bg-amber-900/30 text-amber-400";
          } else if (isSoldOut) {
            chipStyle =
              "border-th-border bg-neutral-800/50 text-neutral-500 line-through cursor-not-allowed";
          } else {
            chipStyle = "border-th-border bg-surface-2 text-th-muted";
          }

          const stateText =
            state === "in-stock"
              ? "In stock"
              : state === "on-the-way"
              ? "On the way"
              : state === "sold-out"
              ? "Sold out"
              : "Coming soon";

          return (
            <button
              key={e.us}
              type="button"
              disabled={isSoldOut}
              onClick={() => handleTap(e.us, state)}
              title={`US ${e.us} / EU ${e.eu} — ${stateText}`}
              className={`inline-flex flex-col items-center border-[1.5px] rounded-xl px-3 py-2 transition-all ${chipStyle} ${
                !isSoldOut ? "cursor-pointer hover:border-white/40" : ""
              }`}
            >
              <span className="text-sm font-extrabold leading-none">
                US {e.us}
              </span>
              <span className="text-[10px] font-semibold mt-1 leading-none opacity-80">
                {stateText}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
