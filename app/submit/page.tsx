"use client";

import { useState } from "react";

type Preview = {
  title: string | null;
  image: string | null;
  price: number | null;
  brand: string | null;
};

export default function SubmitPage() {
  const [url, setUrl] = useState("");
  const [sizes, setSizes] = useState("");
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function fetchPreview() {
    if (!url) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (res.ok) setPreview(await res.json());
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!url) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/shoes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          sizes: sizes || null,
          notes: notes || null,
          title: preview?.title ?? undefined,
          image_url: preview?.image ?? undefined,
          price_usd: preview?.price ?? undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMsg(j.error ?? "Failed to add shoe.");
      } else {
        setMsg("Added. It will appear as upcoming on the homepage.");
        setUrl("");
        setSizes("");
        setNotes("");
        setPreview(null);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Add a shoe</h1>
      <p className="text-neutral-600 mt-2 text-sm">
        Paste a product URL from Nike, Adidas, Foot Locker, etc. We&apos;ll pull
        the image and title automatically.
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Product URL</label>
          <div className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.nike.com/t/..."
              className="flex-1 border border-neutral-300 rounded px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={fetchPreview}
              disabled={loading || !url}
              className="px-4 py-2 rounded bg-neutral-900 text-white text-sm disabled:opacity-50"
            >
              Preview
            </button>
          </div>
        </div>

        {preview && (
          <div className="border border-neutral-200 rounded p-3 flex gap-3 items-start">
            {preview.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.image}
                alt=""
                className="w-20 h-20 object-cover rounded bg-neutral-100"
              />
            ) : (
              <div className="w-20 h-20 rounded bg-neutral-100" />
            )}
            <div className="text-sm">
              {preview.brand && (
                <div className="text-[11px] uppercase tracking-wider text-neutral-500">
                  {preview.brand}
                </div>
              )}
              <div className="font-medium">{preview.title ?? url}</div>
              {preview.price != null && (
                <div className="text-neutral-600">${preview.price}</div>
              )}
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">
            Sizes (comma separated)
          </label>
          <input
            type="text"
            value={sizes}
            onChange={(e) => setSizes(e.target.value)}
            placeholder="9, 10, 10.5"
            className="w-full border border-neutral-300 rounded px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Color, quantity, anything the buyer should know"
            className="w-full border border-neutral-300 rounded px-3 py-2 text-sm"
          />
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={loading || !url}
          className="px-4 py-2 rounded bg-black text-white text-sm disabled:opacity-50"
        >
          {loading ? "Working..." : "Add shoe"}
        </button>

        {msg && <div className="text-sm text-neutral-700">{msg}</div>}
      </div>
    </div>
  );
}
