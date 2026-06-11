"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const ETHIOPIC_FONT =
  "var(--font-ethiopic), 'Abyssinica SIL', 'Nyala', sans-serif";

/**
 * Interest CTA for the /shoe/[id] details page.
 *
 * Same contract as the homepage card: POST /api/interests with
 * { shoe_id, size|null, notes|null } then router.refresh() so the
 * server-computed alreadyRequested flips. Gate mirrors ShoeCard:
 * status !== "sold" && signedIn && !alreadyRequested.
 */
export function InterestButton({
  shoeId,
  sold,
  signedIn,
  alreadyRequested,
  sizeOptions = [],
}: {
  shoeId: string;
  sold: boolean;
  signedIn: boolean;
  alreadyRequested: boolean;
  /** Listed US sizes — rendered as quick-pick chips above the free input. */
  sizeOptions?: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (sold) return null;

  if (!signedIn) {
    return (
      <Link
        href="/auth/sign-in"
        className="inline-flex items-center justify-center text-sm font-bold border-[1.5px] border-line text-muted rounded-xl px-6 py-3 hover:border-ink hover:text-ink transition-colors"
      >
        Sign in to reserve
      </Link>
    );
  }

  if (alreadyRequested) {
    return (
      <div className="inline-flex items-center text-sm font-bold text-accent-green border-[1.5px] border-accent-green/40 bg-[#e3f6ec] rounded-xl px-6 py-3">
        Requested ✓ — we&apos;ll reach out
      </div>
    );
  }

  async function send() {
    setLoading(true);
    setErr(null);
    const res = await fetch("/api/interests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shoe_id: shoeId,
        size: size || null,
        notes: notes || null,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "Failed to send.");
    } else {
      setOpen(false);
      router.refresh();
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 text-sm font-extrabold bg-ink text-cream rounded-xl px-7 py-3.5 hover:bg-accent-deep transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        I want this ·{" "}
        <span lang="am" style={{ fontFamily: ETHIOPIC_FONT, lineHeight: 1.4 }}>
          እፈልጋለሁ
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-2.5 max-w-sm">
      {sizeOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sizeOptions.map((us) => (
            <button
              key={us}
              type="button"
              onClick={() => setSize(us)}
              className={`text-xs font-bold rounded-lg px-2.5 py-1.5 border-[1.5px] transition-colors ${
                size === us
                  ? "border-accent bg-accent text-white"
                  : "border-line bg-cream text-[#4d493f] hover:border-ink"
              }`}
            >
              US {us}
            </button>
          ))}
        </div>
      )}
      <input
        type="text"
        value={size}
        onChange={(e) => setSize(e.target.value)}
        placeholder="Size (optional)"
        className="w-full border border-line bg-paper rounded-lg px-3 py-2 text-sm"
      />
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        className="w-full border border-line bg-paper rounded-lg px-3 py-2 text-sm"
      />
      {err && <div className="text-xs text-red-600">{err}</div>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={send}
          disabled={loading}
          className="flex-1 text-sm font-extrabold rounded-xl px-4 py-2.5 disabled:opacity-50 text-cream bg-ink hover:bg-accent-deep transition-colors"
        >
          {loading ? "Sending..." : "Send request"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={loading}
          className="text-sm font-bold border-[1.5px] border-line rounded-xl px-4 py-2.5 hover:border-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
