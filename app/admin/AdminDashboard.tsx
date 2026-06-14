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
  ShoeEvent,
  Payment,
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

type Tab = "shoes" | "users" | "interests" | "payments";

export function AdminDashboard({
  me,
  role,
  shoes,
  profiles,
  interestsByShoe,
  eventsByShoe = {},
  staleShoeIds = [],
  staleAgeDaysById = {},
  recentPayments,
  paymentsEnabled,
}: {
  me: string;
  role: Role;
  shoes: Shoe[];
  profiles: Profile[];
  interestsByShoe: Record<string, InterestWithEmail[]>;
  eventsByShoe?: Record<string, ShoeEvent[]>;
  /** IDs of shoes that meet the stale criteria (upcoming + no logistics progress + >7d) */
  staleShoeIds?: string[];
  /** Days-old for each stale shoe ID */
  staleAgeDaysById?: Record<string, number>;
  recentPayments?: Payment[];
  paymentsEnabled?: boolean;
}) {
  const router = useRouter();
  const isAdmin = role === "admin";
  const [tab, setTab] = useState<Tab>("shoes");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [staleFilterActive, setStaleFilterActive] = useState(false);

  const staleSet = new Set(staleShoeIds);
  const staleCount = staleShoeIds.length;

  // Filter state — "shoes" tab only
  const [salesStatusFilter, setSalesStatusFilter] = useState<ShoeStatus | "">("");
  const [logisticsStatusFilter, setLogisticsStatusFilter] = useState<LogisticsStatus | "">("");

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

  // Payment test form state (admin only, paymentsEnabled only)
  const [payShoeId, setPayShoeId] = useState<string>("");
  const [paySize, setPaySize] = useState<string>("");
  const [payAmount, setPayAmount] = useState<string>("500");
  const [payEmail, setPayEmail] = useState<string>(me);
  const [payMsg, setPayMsg] = useState<string | null>(null);
  const [payLoading, setPayLoading] = useState(false);

  async function startTestPayment() {
    setPayMsg(null);
    setPayLoading(true);
    try {
      const res = await fetch("/api/admin/test-payment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shoe_id: payShoeId || undefined,
          size: paySize || undefined,
          amount: parseFloat(payAmount),
          email: payEmail,
        }),
      });
      const j = await res.json().catch(() => ({})) as { checkout_url?: string; error?: string };
      if (!res.ok) {
        setPayMsg(j.error ?? "Request failed.");
      } else if (j.checkout_url) {
        window.open(j.checkout_url, "_blank", "noopener,noreferrer");
        setPayMsg("Chapa checkout opened in a new tab.");
        router.refresh();
      }
    } finally {
      setPayLoading(false);
    }
  }

  // Tabs available depend on role. Shippers see only the shoes list (to set
  // per-size logistics status). Admins see everything.
  const tabs: Array<[Tab, string]> = isAdmin
    ? [
        ["shoes", "Shoes"],
        ["users", "Users"],
        ["interests", "Interests"],
        ...(paymentsEnabled ? ([["payments", "Payments (test)"]] as Array<[Tab, string]>) : []),
      ]
    : [["shoes", "Shoes"]];

  // Apply filters to the shoes array (client-side, AND logic).
  const filteredShoes = shoes.filter((s) => {
    if (salesStatusFilter !== "" && s.status !== salesStatusFilter) return false;
    if (logisticsStatusFilter !== "") {
      const sizes = s.shoe_sizes ?? [];
      const hasMatchingSize = sizes.some((sz) => sz.logistics_status === logisticsStatusFilter);
      if (!hasMatchingSize) return false;
    }
    return true;
  });

  const hasActiveFilters = salesStatusFilter !== "" || logisticsStatusFilter !== "";

  // When the stale filter is active, further restrict to stale rows (shoes tab only).
  const visibleShoes =
    staleFilterActive && tab === "shoes"
      ? filteredShoes.filter((s) => staleSet.has(s.id))
      : filteredShoes;

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

      {/* Stale attention banner — shown in the Shoes tab when there are stale items */}
      {tab === "shoes" && staleCount > 0 && (
        <button
          type="button"
          onClick={() => setStaleFilterActive((v) => !v)}
          className={`w-full mb-4 flex items-center gap-2 px-4 py-2.5 rounded border text-sm font-medium transition-colors ${
            staleFilterActive
              ? "bg-amber-100 border-amber-400 text-amber-900"
              : "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100"
          }`}
        >
          <span>&#9888;</span>
          <span>
            {staleCount} shoe{staleCount === 1 ? "" : "s"} need attention
            (upcoming, no logistics progress, &gt;7 days old)
          </span>
          <span className="ml-auto text-xs font-normal">
            {staleFilterActive ? "Show all" : "Filter to these"}
          </span>
        </button>
      )}

      {tab === "shoes" && (
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-3 p-3 bg-neutral-50 border border-neutral-200 rounded">
            <div className="flex items-center gap-1.5">
              <label
                htmlFor="filter-sales"
                className="text-xs text-neutral-500 whitespace-nowrap"
              >
                Sales status
              </label>
              <select
                id="filter-sales"
                value={salesStatusFilter}
                onChange={(e) =>
                  setSalesStatusFilter(e.target.value as ShoeStatus | "")
                }
                className="border border-neutral-300 rounded px-2 py-1 text-xs bg-white"
              >
                <option value="">All</option>
                {STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <label
                htmlFor="filter-logistics"
                className="text-xs text-neutral-500 whitespace-nowrap"
              >
                Logistics status
              </label>
              <select
                id="filter-logistics"
                value={logisticsStatusFilter}
                onChange={(e) =>
                  setLogisticsStatusFilter(e.target.value as LogisticsStatus | "")
                }
                className="border border-neutral-300 rounded px-2 py-1 text-xs bg-white"
              >
                <option value="">All</option>
                {LOGISTICS.map((ls) => (
                  <option key={ls} value={ls}>
                    {ls}
                  </option>
                ))}
              </select>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setSalesStatusFilter("");
                  setLogisticsStatusFilter("");
                }}
                className="text-xs text-neutral-500 hover:text-neutral-800 underline ml-auto"
              >
                Clear filters
              </button>
            )}

            {hasActiveFilters && (
              <span className="text-xs text-neutral-400">
                {filteredShoes.length} of {shoes.length}
              </span>
            )}
          </div>

          {visibleShoes.map((s) => (
            <ShoeRow
              key={s.id}
              shoe={s}
              isAdmin={isAdmin}
              loading={loading}
              interestCount={interestsByShoe[s.id]?.length ?? 0}
              events={eventsByShoe[s.id] ?? []}
              onUpdateStatus={(st) => updateShoe(s.id, { status: st })}
              onSetSizeStatus={(usSize, ls) => setSizeStatus(s.id, usSize, ls)}
              onAddSize={isAdmin ? (usSize) => addSizeToShoe(s.id, usSize) : undefined}
              onRemoveSize={isAdmin ? (usSize) => removeSizeFromShoe(s.id, usSize) : undefined}
              onDelete={isAdmin ? () => deleteShoe(s.id) : undefined}
              staleBadge={
                staleSet.has(s.id)
                  ? { days: staleAgeDaysById[s.id] ?? 0 }
                  : undefined
              }
            />
          ))}
          {visibleShoes.length === 0 && (
            <div className="border border-neutral-200 rounded p-6 text-center text-neutral-500 text-sm">
              {staleFilterActive
                ? "No stale shoes — everything is moving."
                : hasActiveFilters
                ? "No shoes match the selected filters."
                : "No shoes yet."}
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

      {tab === "payments" && isAdmin && paymentsEnabled && (
        <div className="space-y-6">
          {/* Test payment form */}
          <div className="border border-neutral-200 rounded p-4">
            <h2 className="text-sm font-medium mb-1">Initiate test payment</h2>
            <p className="text-xs text-neutral-500 mb-3">
              Admin-only POC. Opens Chapa&apos;s hosted test checkout (Telebirr / CBE / local
              cards). No real money is moved in test mode.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className="text-xs text-neutral-600 block mb-1">
                  Shoe (optional)
                </label>
                <select
                  value={payShoeId}
                  onChange={(e) => setPayShoeId(e.target.value)}
                  className="w-full border border-neutral-300 rounded px-2 py-1.5 text-sm"
                >
                  <option value="">— no specific shoe —</option>
                  {shoes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-neutral-600 block mb-1">
                  Size (optional)
                </label>
                <input
                  type="text"
                  value={paySize}
                  onChange={(e) => setPaySize(e.target.value)}
                  placeholder="e.g. 10"
                  className="w-full border border-neutral-300 rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-600 block mb-1">
                  Amount (ETB)
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full border border-neutral-300 rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-600 block mb-1">
                  Test email
                </label>
                <input
                  type="email"
                  value={payEmail}
                  onChange={(e) => setPayEmail(e.target.value)}
                  className="w-full border border-neutral-300 rounded px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={startTestPayment}
                disabled={payLoading || !payAmount || !payEmail}
                className="px-4 py-2 rounded bg-black text-white text-sm disabled:opacity-50"
              >
                {payLoading ? "Initializing..." : "Open Chapa checkout"}
              </button>
              {payMsg && (
                <span className="text-xs text-neutral-600">{payMsg}</span>
              )}
            </div>
          </div>

          {/* Recent payments list */}
          <div>
            <h2 className="text-sm font-medium mb-3">Recent payments (last 20)</h2>
            {(recentPayments ?? []).length === 0 ? (
              <div className="text-sm text-neutral-500">No payments yet.</div>
            ) : (
              <div className="overflow-x-auto border border-neutral-200 rounded">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-left text-neutral-600">
                    <tr>
                      <th className="p-2">tx_ref</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Amount</th>
                      <th className="p-2">Email</th>
                      <th className="p-2">Size</th>
                      <th className="p-2">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(recentPayments ?? []).map((p) => (
                      <tr key={p.id} className="border-t border-neutral-200">
                        <td className="p-2 font-mono text-xs">{p.tx_ref}</td>
                        <td className="p-2">
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                              p.status === "paid"
                                ? "bg-[#1F7A52] text-white"
                                : p.status === "failed"
                                ? "bg-red-100 text-red-700"
                                : "bg-neutral-100 text-neutral-600"
                            }`}
                          >
                            {p.status}
                          </span>
                        </td>
                        <td className="p-2">
                          {p.amount} {p.currency}
                        </td>
                        <td className="p-2">{p.customer_email ?? "—"}</td>
                        <td className="p-2">{p.size ?? "—"}</td>
                        <td className="p-2 text-neutral-500">
                          {new Date(p.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ShoeRow — per-shoe card with per-size logistics editor + event timeline
// ---------------------------------------------------------------------------

/**
 * Renders one shoe as a card (replacing the old table row).
 * The logistics section is now a per-size chip grid, not a single dropdown.
 * The timeline section shows recent shoe_events rows (collapsible).
 *
 * Shippers: can change the logistics_status of any existing size chip.
 * Admins: additionally can add/remove sizes from the SIZE_GRID.
 */
function ShoeRow({
  shoe,
  isAdmin,
  loading,
  interestCount,
  events,
  onUpdateStatus,
  onSetSizeStatus,
  onAddSize,
  onRemoveSize,
  onDelete,
  staleBadge,
}: {
  shoe: Shoe;
  isAdmin: boolean;
  loading: boolean;
  interestCount: number;
  events: ShoeEvent[];
  onUpdateStatus: (st: ShoeStatus) => void;
  onSetSizeStatus: (usSize: string, ls: LogisticsStatus | null) => void;
  onAddSize?: (usSize: string) => void;
  onRemoveSize?: (usSize: string) => void;
  onDelete?: () => void;
  /** If set, renders an inline amber stale badge with the age in days */
  staleBadge?: { days: number };
}) {
  const sizes: ShoeSize[] = shoe.shoe_sizes ?? [];
  const sizeByUs = new Map(sizes.map((sz) => [sz.us_size, sz]));
  const [timelineOpen, setTimelineOpen] = useState(false);

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
            {staleBadge && (
              <div className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                Stale &middot; {staleBadge.days}d
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
        {/* Heading row with optional batch quick-action button */}
        <BatchQuickAction
          sizes={sizes}
          loading={loading}
          onSetSizeStatus={onSetSizeStatus}
        />

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

      {/* Event timeline — collapsible, shown when events are available */}
      {events.length > 0 && (
        <div className="border-t border-neutral-100 pt-3 mt-1">
          <button
            type="button"
            onClick={() => setTimelineOpen((o) => !o)}
            className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-neutral-500 hover:text-neutral-700"
            aria-expanded={timelineOpen}
          >
            <span>Timeline</span>
            <span className="text-neutral-400 ml-1">
              ({events.length})
            </span>
            <span className="ml-1 text-neutral-400">
              {timelineOpen ? "▲" : "▼"}
            </span>
          </button>

          {timelineOpen && (
            <div className="mt-2 space-y-0">
              {events.map((ev) => (
                <EventRow key={ev.id} event={ev} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EventRow — one row in the per-shoe event timeline
// ---------------------------------------------------------------------------

function eventIcon(type: ShoeEvent["event_type"]): string {
  switch (type) {
    case "shoe_created":
      return "■";
    case "sales_status_change":
      return "●";
    case "logistics_status_change":
      return "→";
  }
}

function eventLabel(ev: ShoeEvent): string {
  switch (ev.event_type) {
    case "shoe_created":
      return `Created (${ev.to_value ?? "upcoming"})`;
    case "sales_status_change":
      return `Sales: ${ev.from_value ?? "—"} → ${ev.to_value ?? "—"}`;
    case "logistics_status_change":
      return ev.us_size
        ? `US ${ev.us_size}: ${ev.from_value ?? "—"} → ${ev.to_value ?? "—"}`
        : `Logistics: ${ev.from_value ?? "—"} → ${ev.to_value ?? "—"}`;
  }
}

function formatEventTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function EventRow({ event }: { event: ShoeEvent }) {
  const actorSource =
    event.actor || event.source
      ? [event.actor, event.source ? `via ${event.source}` : null]
          .filter(Boolean)
          .join(" ")
      : "(system)";

  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-neutral-50 last:border-0">
      {/* Icon */}
      <span className="text-neutral-400 text-[11px] w-4 shrink-0 mt-0.5 text-center">
        {eventIcon(event.event_type)}
      </span>
      {/* Timestamp */}
      <span className="text-[10px] text-neutral-400 whitespace-nowrap shrink-0 mt-0.5 w-28">
        {formatEventTime(event.created_at)}
      </span>
      {/* Label */}
      <span className="text-xs text-neutral-700 flex-1 min-w-0">
        {eventLabel(event)}
      </span>
      {/* Actor/source */}
      <span className="text-[10px] text-neutral-400 whitespace-nowrap shrink-0 max-w-[120px] truncate">
        {actorSource}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick-action helpers — derive next logical status for a chip
// ---------------------------------------------------------------------------

/** Returns the next actionable logistics status, or null if no quick action. */
function nextLogisticsStatus(
  current: LogisticsStatus | null
): LogisticsStatus | null {
  switch (current) {
    case "in_cart":
      return "purchased";
    case "purchased":
      return "arrived";
    case "arrived":
      return "delivered";
    default:
      return null;
  }
}

/** Human-readable label for the quick-action button. */
function quickActionLabel(next: LogisticsStatus): string {
  switch (next) {
    case "purchased":
      return "Purchased";
    case "arrived":
      return "Arrived";
    case "delivered":
      return "Delivered";
    default:
      return next;
  }
}

/** Button colour for the quick-action: green for arrived, gold for purchased,
 *  neutral-dark for delivered (muted terminal state). */
function quickActionStyle(next: LogisticsStatus): string {
  switch (next) {
    case "arrived":
      return "bg-[#1F7A52] text-white hover:bg-[#195f40]";
    case "purchased":
      return "bg-[#E8B53A] text-neutral-900 hover:bg-[#d4a030]";
    case "delivered":
      return "bg-neutral-700 text-white hover:bg-neutral-800";
    default:
      return "bg-neutral-200 text-neutral-700";
  }
}

// ---------------------------------------------------------------------------
// BatchQuickAction — "Mark all arrived / delivered" heading + button
// ---------------------------------------------------------------------------

/**
 * Renders the "Sizes & logistics" section heading plus an optional batch
 * quick-action button when multiple sizes share the same actionable status.
 * For example, if 3 sizes are all "purchased" → shows "Arrived all (3)".
 * Requires confirmation before firing to prevent accidental mass updates.
 */
function BatchQuickAction({
  sizes,
  loading,
  onSetSizeStatus,
}: {
  sizes: ShoeSize[];
  loading: boolean;
  onSetSizeStatus: (usSize: string, ls: LogisticsStatus | null) => void;
}) {
  // Find the most-common actionable status across sizes (only counts statuses
  // that have a logical next step: in_cart, purchased, arrived).
  const actionableSizes = sizes.filter(
    (sz) => nextLogisticsStatus(sz.logistics_status) !== null
  );

  // Group actionable sizes by their CURRENT status.
  const groups = new Map<LogisticsStatus, ShoeSize[]>();
  for (const sz of actionableSizes) {
    const cur = sz.logistics_status as LogisticsStatus;
    const existing = groups.get(cur) ?? [];
    groups.set(cur, [...existing, sz]);
  }

  // Pick the group with the most members (tie-break: earlier in pipeline).
  const pipeline: LogisticsStatus[] = ["in_cart", "purchased", "arrived"];
  let bestStatus: LogisticsStatus | null = null;
  let bestGroup: ShoeSize[] = [];
  for (const status of pipeline) {
    const group = groups.get(status) ?? [];
    if (group.length > bestGroup.length) {
      bestStatus = status;
      bestGroup = group;
    }
  }

  const showBatch = bestStatus !== null && bestGroup.length > 1;
  const batchNext = bestStatus ? nextLogisticsStatus(bestStatus) : null;

  async function handleBatch() {
    if (!batchNext || !bestStatus) return;
    const label = quickActionLabel(batchNext);
    const confirmed = confirm(
      `Mark all ${bestGroup.length} size${bestGroup.length === 1 ? "" : "s"} as "${label}"?`
    );
    if (!confirmed) return;
    for (const sz of bestGroup) {
      onSetSizeStatus(sz.us_size, batchNext);
    }
  }

  return (
    <div className="flex items-center justify-between mb-2">
      <div className="text-[11px] uppercase tracking-wider text-neutral-500">
        Sizes &amp; logistics
      </div>
      {showBatch && batchNext && (
        <button
          type="button"
          onClick={handleBatch}
          disabled={loading}
          className={`rounded px-2.5 py-1 text-[10px] font-semibold leading-none disabled:opacity-50 transition-colors ${quickActionStyle(batchNext)}`}
          title={`Mark all ${bestGroup.length} sizes at "${bestStatus}" as "${batchNext}"`}
        >
          {quickActionLabel(batchNext)} all ({bestGroup.length})
        </button>
      )}
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
  const next = nextLogisticsStatus(sz.logistics_status);

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
      className={`inline-flex flex-col items-center rounded border px-2 py-1 gap-1 ${chipColor}`}
    >
      <span className="text-xs font-medium">US {sz.us_size}</span>

      {/* Quick-action button — primary interaction, most prominent */}
      {next && (
        <button
          type="button"
          onClick={() => onSetStatus(next)}
          disabled={loading}
          className={`rounded px-2 py-0.5 text-[10px] font-semibold leading-none disabled:opacity-50 transition-colors ${quickActionStyle(next)}`}
          aria-label={`Mark US ${sz.us_size} as ${next}`}
        >
          {quickActionLabel(next)}
        </button>
      )}

      {/* Current status label (shipper view) OR dropdown (admin view) */}
      {isAdmin ? (
        /* Admin: keep the full dropdown but de-emphasise it below the quick-action button */
        <select
          value={sz.logistics_status ?? ""}
          onChange={(e) =>
            onSetStatus((e.target.value || null) as LogisticsStatus | null)
          }
          disabled={loading}
          className="text-[10px] border-0 bg-transparent p-0 cursor-pointer focus:outline-none opacity-70"
          aria-label={`Logistics status for US ${sz.us_size}`}
        >
          <option value="">— none</option>
          {LOGISTICS.map((ls) => (
            <option key={ls} value={ls}>
              {ls}
            </option>
          ))}
        </select>
      ) : (
        /* Shipper: show current status as a plain label — no dropdown needed */
        <span className="text-[10px] opacity-75">
          {sz.logistics_status ?? "none"}
        </span>
      )}

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
