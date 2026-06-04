"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  Shoe,
  ShoeSize,
  ShoeStatus,
  Profile,
  Role,
  LogisticsStatus,
} from "@/lib/supabase";
import { SIZE_GRID } from "@/lib/sizes";

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
const ROLES: Role[] = ["customer", "submitter", "shipper", "admin"];
// LOGISTICS kept for per-size dropdowns — must stay in sync with the four places.
const LOGISTICS: LogisticsStatus[] = [
  "in_cart",
  "purchased",
  "arrived",
  "delivered",
];

type Tab = "shoes" | "users" | "interests";

export function AdminDashboard({
  me,
  role,
  shoes,
  profiles,
  interestsByShoe,
}: {
  me: string;
  role: Role;
  shoes: Shoe[];
  profiles: Profile[];
  interestsByShoe: Record<string, InterestWithEmail[]>;
}) {
  const router = useRouter();
  const isAdmin = role === "admin";
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

  async function updateRole(id: string, r: Role) {
    await call(`/api/profiles/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: r }),
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

  // Per-size status update: PATCH /api/shoes/:id/sizes
  async function setSizeStatus(
    shoeId: string,
    usSize: string,
    newStatus: LogisticsStatus | null
  ) {
    await call(`/api/shoes/${shoeId}/sizes`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ us_size: usSize, logistics_status: newStatus }),
    });
  }

  // Add a size to a shoe: POST /api/shoes/:id/sizes (admin only)
  async function addSizeToShoe(shoeId: string, usSize: string) {
    await call(`/api/shoes/${shoeId}/sizes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ us_size: usSize }),
    });
  }

  // Remove a size: DELETE /api/shoes/:id/sizes?us_size=X (admin only)
  async function removeSizeFromShoe(shoeId: string, usSize: string) {
    if (!confirm(`Remove US ${usSize} from this shoe?`)) return;
    await call(`/api/shoes/${shoeId}/sizes?us_size=${encodeURIComponent(usSize)}`, {
      method: "DELETE",
    });
  }

  // Tabs available depend on role. Shippers see only the shoes list (to set
  // per-size logistics status). Admins see everything.
  const tabs: Array<[Tab, string]> = isAdmin
    ? [
        ["shoes", "Shoes"],
        ["users", "Users"],
        ["interests", "Interests"],
      ]
    : [["shoes", "Shoes"]];

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">
          {isAdmin ? "Admin" : "Logistics"}
        </h1>
        <div className="text-xs text-neutral-500">{me}</div>
      </div>

      {tabs.length > 1 && (
        <div className="flex gap-1 border-b border-neutral-200 mb-6 text-sm">
          {tabs.map(([key, label]) => (
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
      )}

      {msg && <div className="mb-4 text-sm text-red-600">{msg}</div>}

      {tab === "shoes" && (
        <div className="space-y-4">
          {shoes.map((s) => (
            <ShoeRow
              key={s.id}
              shoe={s}
              isAdmin={isAdmin}
              loading={loading}
              interestCount={interestsByShoe[s.id]?.length ?? 0}
              onUpdateStatus={(st) => updateShoe(s.id, { status: st })}
              onSetSizeStatus={(usSize, ls) => setSizeStatus(s.id, usSize, ls)}
              onAddSize={isAdmin ? (usSize) => addSizeToShoe(s.id, usSize) : undefined}
              onRemoveSize={isAdmin ? (usSize) => removeSizeFromShoe(s.id, usSize) : undefined}
              onDelete={isAdmin ? () => deleteShoe(s.id) : undefined}
            />
          ))}
          {shoes.length === 0 && (
            <div className="border border-neutral-200 rounded p-6 text-center text-neutral-500 text-sm">
              No shoes yet.
            </div>
          )}
        </div>
      )}

      {tab === "users" && isAdmin && (
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

      {tab === "interests" && isAdmin && (
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

// ---------------------------------------------------------------------------
// ShoeRow — per-shoe card with per-size logistics editor
// ---------------------------------------------------------------------------

/**
 * Renders one shoe as a card (replacing the old table row).
 * The logistics section is now a per-size chip grid, not a single dropdown.
 *
 * Shippers: can change the logistics_status of any existing size chip.
 * Admins: additionally can add/remove sizes from the SIZE_GRID.
 */
function ShoeRow({
  shoe,
  isAdmin,
  loading,
  interestCount,
  onUpdateStatus,
  onSetSizeStatus,
  onAddSize,
  onRemoveSize,
  onDelete,
}: {
  shoe: Shoe;
  isAdmin: boolean;
  loading: boolean;
  interestCount: number;
  onUpdateStatus: (st: ShoeStatus) => void;
  onSetSizeStatus: (usSize: string, ls: LogisticsStatus | null) => void;
  onAddSize?: (usSize: string) => void;
  onRemoveSize?: (usSize: string) => void;
  onDelete?: () => void;
}) {
  const sizes: ShoeSize[] = shoe.shoe_sizes ?? [];
  const sizeByUs = new Map(sizes.map((sz) => [sz.us_size, sz]));

  // Available sizes from SIZE_GRID that aren't yet added to this shoe
  const addableSizes = SIZE_GRID.map((e) => e.us).filter((us) => !sizeByUs.has(us));
  const [addValue, setAddValue] = useState<string>(addableSizes[0] ?? "");

  return (
    <div className="border border-neutral-200 rounded p-4">
      <div className="flex gap-3 mb-3">
        {/* Thumbnail */}
        {shoe.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shoe.image_url}
            alt=""
            className="w-16 h-16 object-cover rounded bg-neutral-100 flex-shrink-0"
          />
        ) : (
          <div className="w-16 h-16 rounded bg-neutral-100 flex-shrink-0" />
        )}

        {/* Title + meta */}
        <div className="flex-1 min-w-0">
          {isAdmin ? (
            <a
              href={shoe.url}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium underline truncate block"
            >
              {shoe.title}
            </a>
          ) : (
            <div className="text-sm font-medium truncate">{shoe.title}</div>
          )}
          {shoe.brand && (
            <div className="text-[11px] uppercase tracking-wider text-neutral-500 mt-0.5">
              {shoe.brand}
            </div>
          )}
          {shoe.notes && (
            <div className="text-xs text-neutral-500 mt-1">{shoe.notes}</div>
          )}
          <div className="flex flex-wrap gap-3 mt-2 items-center">
            {/* Sales status — admin only */}
            {isAdmin && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-neutral-500">Sales:</span>
                <select
                  value={shoe.status}
                  onChange={(e) => onUpdateStatus(e.target.value as ShoeStatus)}
                  disabled={loading}
                  className="border border-neutral-300 rounded px-1.5 py-0.5 text-xs"
                >
                  {STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {isAdmin && (
              <div className="text-xs text-neutral-500">
                {interestCount > 0 ? `${interestCount} interested` : ""}
              </div>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                disabled={loading}
                className="ml-auto text-xs text-red-600 hover:underline"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Per-size logistics editor */}
      <div className="border-t border-neutral-100 pt-3">
        <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-2">
          Sizes &amp; logistics
        </div>

        {sizes.length === 0 && !isAdmin && (
          <div className="text-xs text-neutral-400 italic">
            No sizes added yet. Ask an admin to add sizes.
          </div>
        )}

        {/* Existing size chips */}
        <div className="flex flex-wrap gap-2 mb-2">
          {sizes.map((sz) => (
            <SizeStatusChip
              key={sz.us_size}
              sz={sz}
              isAdmin={isAdmin}
              loading={loading}
              onSetStatus={(ls) => onSetSizeStatus(sz.us_size, ls)}
              onRemove={onRemoveSize ? () => onRemoveSize(sz.us_size) : undefined}
            />
          ))}
        </div>

        {/* Add a size — admin only */}
        {isAdmin && onAddSize && addableSizes.length > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <select
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              disabled={loading}
              className="border border-neutral-300 rounded px-2 py-1 text-xs"
            >
              {addableSizes.map((us) => (
                <option key={us} value={us}>
                  US {us}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                if (addValue) onAddSize(addValue);
              }}
              disabled={loading || !addValue}
              className="text-xs border border-neutral-300 rounded px-2 py-1 hover:bg-neutral-50 disabled:opacity-50"
            >
              + Add size
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SizeStatusChip — one chip per shoe_sizes row in the admin editor
// ---------------------------------------------------------------------------

function SizeStatusChip({
  sz,
  isAdmin,
  loading,
  onSetStatus,
  onRemove,
}: {
  sz: ShoeSize;
  isAdmin: boolean;
  loading: boolean;
  onSetStatus: (ls: LogisticsStatus | null) => void;
  onRemove?: () => void;
}) {
  // Colour encodes customer-visible state:
  // arrived → green; purchased → gold; in_cart/null → neutral; delivered → muted
  const chipColor =
    sz.logistics_status === "arrived"
      ? "bg-[#1F7A52] text-white border-[#1F7A52]"
      : sz.logistics_status === "purchased"
      ? "bg-[#E8B53A] text-neutral-900 border-[#E8B53A]"
      : sz.logistics_status === "delivered"
      ? "bg-neutral-100 text-neutral-400 border-neutral-200"
      : "bg-white text-neutral-700 border-neutral-300"; // null or in_cart

  return (
    <div
      className={`inline-flex flex-col items-center rounded border px-2 py-1 gap-0.5 ${chipColor}`}
    >
      <span className="text-xs font-medium">US {sz.us_size}</span>
      {/* Status selector — shipper + admin */}
      <select
        value={sz.logistics_status ?? ""}
        onChange={(e) =>
          onSetStatus((e.target.value || null) as LogisticsStatus | null)
        }
        disabled={loading}
        className="text-[10px] border-0 bg-transparent p-0 cursor-pointer focus:outline-none"
        aria-label={`Logistics status for US ${sz.us_size}`}
      >
        <option value="">— none</option>
        {LOGISTICS.map((ls) => (
          <option key={ls} value={ls}>
            {ls}
          </option>
        ))}
      </select>
      {/* Remove button — admin only */}
      {isAdmin && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={loading}
          className="text-[9px] opacity-60 hover:opacity-100"
          aria-label={`Remove US ${sz.us_size}`}
        >
          remove
        </button>
      )}
    </div>
  );
}
