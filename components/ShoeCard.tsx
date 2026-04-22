"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Shoe } from "@/lib/supabase";

export function ShoeCard({
  shoe,
  dim = false,
  signedIn = false,
  canRequest = false,
  alreadyRequested = false,
}: {
  shoe: Shoe;
  dim?: boolean;
  signedIn?: boolean;
  canRequest?: boolean;
  alreadyRequested?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <div
      className={`rounded-lg border border-neutral-200 overflow-hidden bg-white flex flex-col ${
        dim ? "opacity-50" : ""
      }`}
    >
      <div className="aspect-square bg-neutral-100 relative">
        {shoe.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shoe.image_url}
            alt={shoe.title}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-neutral-400 text-sm">
            No image
          </div>
        )}
        {shoe.status === "upcoming" && (
          <span className="absolute top-2 left-2 text-[10px] uppercase tracking-wider bg-black text-white px-2 py-1 rounded">
            Upcoming
          </span>
        )}
        {shoe.status === "sold" && (
          <span className="absolute top-2 left-2 text-[10px] uppercase tracking-wider bg-neutral-700 text-white px-2 py-1 rounded">
            Sold
          </span>
        )}
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

        {shoe.status !== "sold" && (
          <div className="mt-auto">
            {!signedIn ? (
              <a
                href="/auth/sign-in"
                className="block w-full text-center text-xs border border-neutral-300 rounded px-3 py-2 hover:bg-neutral-50"
              >
                Sign in to request
              </a>
            ) : alreadyRequested ? (
              <div className="text-xs text-center text-neutral-500 border border-neutral-200 rounded px-3 py-2">
                You requested this
              </div>
            ) : canRequest && !open ? (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="w-full text-xs bg-black text-white rounded px-3 py-2"
              >
                I want this
              </button>
            ) : canRequest && open ? (
              <div className="space-y-2">
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
                    className="flex-1 text-xs bg-black text-white rounded px-2 py-1 disabled:opacity-50"
                  >
                    {loading ? "Sending..." : "Send request"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={loading}
                    className="text-xs border border-neutral-300 rounded px-2 py-1"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
