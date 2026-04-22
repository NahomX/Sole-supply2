"use client";

import { useEffect, useState } from "react";
import type { Shoe, ShoeStatus } from "@/lib/supabase";

const STATUSES: ShoeStatus[] = ["upcoming", "available", "sold"];

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [shoes, setShoes] = useState<Shoe[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    const res = await fetch("/api/shoes", { cache: "no-store" });
    if (res.ok) {
      const j = await res.json();
      setShoes(j.shoes ?? []);
    }
  }

  useEffect(() => {
    if (unlocked) load();
  }, [unlocked]);

  async function update(id: string, patch: Partial<Shoe>) {
    setLoading(true);
    try {
      await fetch(`/api/shoes/${id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-admin-password": password,
        },
        body: JSON.stringify(patch),
      });
      await load();
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this shoe?")) return;
    setLoading(true);
    try {
      await fetch(`/api/shoes/${id}`, {
        method: "DELETE",
        headers: { "x-admin-password": password },
      });
      await load();
    } finally {
      setLoading(false);
    }
  }

  if (!unlocked) {
    return (
      <div className="max-w-sm mx-auto px-4 py-16">
        <h1 className="text-xl font-semibold mb-4">Admin</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Admin password"
          className="w-full border border-neutral-300 rounded px-3 py-2 text-sm mb-3"
        />
        <button
          type="button"
          onClick={() => setUnlocked(password.length > 0)}
          className="w-full px-4 py-2 rounded bg-black text-white text-sm"
        >
          Unlock
        </button>
        <p className="text-xs text-neutral-500 mt-3">
          Password is checked server-side on each write.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <a href="/submit" className="text-sm underline">
          + Add a shoe
        </a>
      </div>

      <div className="overflow-x-auto border border-neutral-200 rounded">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-600">
            <tr>
              <th className="p-2">Image</th>
              <th className="p-2">Title</th>
              <th className="p-2">Brand</th>
              <th className="p-2">Sizes</th>
              <th className="p-2">Status</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {shoes.map((s) => (
              <tr key={s.id} className="border-t border-neutral-200 align-top">
                <td className="p-2">
                  {s.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.image_url}
                      alt=""
                      className="w-14 h-14 object-cover rounded bg-neutral-100"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded bg-neutral-100" />
                  )}
                </td>
                <td className="p-2 max-w-xs">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {s.title}
                  </a>
                  {s.notes && (
                    <div className="text-xs text-neutral-500 mt-1">
                      {s.notes}
                    </div>
                  )}
                </td>
                <td className="p-2">{s.brand ?? "—"}</td>
                <td className="p-2">{s.sizes ?? "—"}</td>
                <td className="p-2">
                  <select
                    value={s.status}
                    onChange={(e) =>
                      update(s.id, { status: e.target.value as ShoeStatus })
                    }
                    disabled={loading}
                    className="border border-neutral-300 rounded px-2 py-1 text-sm"
                  >
                    {STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-2">
                  <button
                    type="button"
                    onClick={() => remove(s.id)}
                    disabled={loading}
                    className="text-red-600 text-xs hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {shoes.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-neutral-500">
                  No shoes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
