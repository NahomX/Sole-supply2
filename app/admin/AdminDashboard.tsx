"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Shoe, ShoeStatus, Profile, Role } from "@/lib/supabase";

type InterestWithEmail = {
  id: string;
  shoe_id: string;
  user_id: string;
  size: string | null;
  notes: string | null;
  created_at: string;
  email: string | null;
};

const STATUSES: ShoeStatus[] = ["upcoming", "available", "sold"];
const ROLES: Role[] = ["customer", "submitter", "admin"];

type Tab = "shoes" | "users" | "interests";

export function AdminDashboard({
  me,
  shoes,
  profiles,
  interestsByShoe,
}: {
  me: string;
  shoes: Shoe[];
  profiles: Profile[];
  interestsByShoe: Record<string, InterestWithEmail[]>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("shoes");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function call(path: string, init: RequestInit) {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(path, init);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMsg(j.error ?? "Request failed.");
      } else {
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  async function updateShoe(id: string, patch: Partial<Shoe>) {
    await call(`/api/shoes/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function deleteShoe(id: string) {
    if (!confirm("Delete this shoe?")) return;
    await call(`/api/shoes/${id}`, { method: "DELETE" });
  }

  async function updateRole(id: string, role: Role) {
    await call(`/api/profiles/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    });
  }

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("submitter");

  async function invite() {
    if (!inviteEmail) return;
    await call("/api/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    setInviteEmail("");
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <div className="text-xs text-neutral-500">{me}</div>
      </div>

      <div className="flex gap-1 border-b border-neutral-200 mb-6 text-sm">
        {(
          [
            ["shoes", "Shoes"],
            ["users", "Users"],
            ["interests", "Interests"],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-3 py-2 border-b-2 ${
              tab === key
                ? "border-black font-medium"
                : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {msg && <div className="mb-4 text-sm text-red-600">{msg}</div>}

      {tab === "shoes" && (
        <div className="overflow-x-auto border border-neutral-200 rounded">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-600">
              <tr>
                <th className="p-2">Image</th>
                <th className="p-2">Title</th>
                <th className="p-2">Brand</th>
                <th className="p-2">Sizes</th>
                <th className="p-2">Interest</th>
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
                    {(interestsByShoe[s.id]?.length ?? 0) || "—"}
                  </td>
                  <td className="p-2">
                    <select
                      value={s.status}
                      onChange={(e) =>
                        updateShoe(s.id, {
                          status: e.target.value as ShoeStatus,
                        })
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
                      onClick={() => deleteShoe(s.id)}
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
                  <td colSpan={7} className="p-6 text-center text-neutral-500">
                    No shoes yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "users" && (
        <div className="space-y-6">
          <div className="border border-neutral-200 rounded p-4">
            <h2 className="text-sm font-medium mb-3">Invite someone</h2>
            <div className="flex flex-wrap gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="email@example.com"
                className="flex-1 min-w-[220px] border border-neutral-300 rounded px-3 py-2 text-sm"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Role)}
                className="border border-neutral-300 rounded px-2 py-2 text-sm"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={invite}
                disabled={loading || !inviteEmail}
                className="px-4 py-2 rounded bg-black text-white text-sm disabled:opacity-50"
              >
                Send invite
              </button>
            </div>
            <p className="text-xs text-neutral-500 mt-2">
              They&apos;ll receive a magic-link email and be assigned that role
              when they accept.
            </p>
          </div>

          <div className="overflow-x-auto border border-neutral-200 rounded">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-neutral-600">
                <tr>
                  <th className="p-2">Email</th>
                  <th className="p-2">Role</th>
                  <th className="p-2">Joined</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id} className="border-t border-neutral-200">
                    <td className="p-2">{p.email ?? "—"}</td>
                    <td className="p-2">
                      <select
                        value={p.role}
                        onChange={(e) =>
                          updateRole(p.id, e.target.value as Role)
                        }
                        disabled={loading}
                        className="border border-neutral-300 rounded px-2 py-1 text-sm"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2 text-neutral-500">
                      {new Date(p.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
                {profiles.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-neutral-500">
                      No users yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "interests" && (
        <div className="space-y-6">
          {shoes
            .map((s) => ({
              shoe: s,
              rows: interestsByShoe[s.id] ?? [],
            }))
            .filter((x) => x.rows.length > 0)
            .map(({ shoe, rows }) => (
              <div
                key={shoe.id}
                className="border border-neutral-200 rounded p-4"
              >
                <div className="flex items-center gap-3 mb-3">
                  {shoe.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={shoe.image_url}
                      alt=""
                      className="w-12 h-12 rounded object-cover bg-neutral-100"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded bg-neutral-100" />
                  )}
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-neutral-500">
                      {shoe.brand ?? "—"}
                    </div>
                    <div className="text-sm font-medium">{shoe.title}</div>
                  </div>
                  <div className="ml-auto text-xs text-neutral-500">
                    {rows.length} interested
                  </div>
                </div>
                <ul className="text-sm divide-y divide-neutral-100">
                  {rows.map((r) => (
                    <li
                      key={r.id}
                      className="py-2 flex flex-wrap gap-x-4 gap-y-1"
                    >
                      <span className="font-medium">{r.email ?? r.user_id}</span>
                      {r.size && (
                        <span className="text-neutral-600">size {r.size}</span>
                      )}
                      {r.notes && (
                        <span className="text-neutral-500">— {r.notes}</span>
                      )}
                      <span className="ml-auto text-xs text-neutral-400">
                        {new Date(r.created_at).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          {Object.keys(interestsByShoe).length === 0 && (
            <div className="text-sm text-neutral-500">
              No one has expressed interest yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
