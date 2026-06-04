import { redirect } from "next/navigation";
import { getSessionInfo } from "@/lib/auth";
import { supabaseService, type Shoe, type Profile, type ShoeEvent, type Payment } from "@/lib/supabase";
import { AdminDashboard } from "./AdminDashboard";
import { isStale, staleAgeDays } from "@/lib/staleness";

export const dynamic = "force-dynamic";

type InterestRow = {
  id: string;
  shoe_id: string;
  size: string | null;
  notes: string | null;
  created_at: string;
  user_id: string;
};

export default async function AdminPage() {
  const session = await getSessionInfo();
  if (!session) redirect("/auth/sign-in?next=/admin");
  const role = session.profile?.role ?? "customer";
  if (role !== "admin" && role !== "shipper") {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-semibold mb-2">Not authorized</h1>
        <p className="text-sm text-neutral-600">
          This area is for admins only.
        </p>
      </div>
    );
  }

  const db = supabaseService();
  // Shippers only need the shoes list (to update per-size logistics status).
  // Skip the profiles + interests queries for them — those are admin-only views.
  // Join shoe_sizes so the per-size editor has current status data.
  const isAdmin = role === "admin";
  const shoesQ = await db
    .from("shoes")
    .select("*, shoe_sizes(*)")
    .order("created_at", { ascending: false });
  const shoes = (shoesQ.data as Shoe[]) ?? [];

  let profiles: Profile[] = [];
  let interests: InterestRow[] = [];
  // shoe_events: fetch recent events for all shoes loaded above.
  // Uses supabaseService (service-role) — bypasses RLS (no policies on shoe_events).
  // Limit 50 per shoe to cap payload; index on (shoe_id, created_at desc) covers this.
  let eventsByShoe: Record<string, ShoeEvent[]> = {};
  let recentPayments: Payment[] = [];
  const paymentsEnabled = process.env.PAYMENTS_POC_ENABLED === "true";

  if (isAdmin) {
    const shoeIds = shoes.map((s) => s.id);
    const [profilesQ, interestsQ, eventsQ] = await Promise.all([
      db.from("profiles").select("*").order("created_at", { ascending: false }),
      db.from("interests").select("*").order("created_at", { ascending: false }),
      // Fetch events for all shoes: order by created_at desc, limit 50 per shoe
      // via a single query (no per-shoe subqueries needed at this scale).
      shoeIds.length > 0
        ? db
            .from("shoe_events")
            .select("*")
            .in("shoe_id", shoeIds)
            .order("created_at", { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [], error: null }),
    ]);
    profiles = (profilesQ.data as Profile[]) ?? [];
    interests = (interestsQ.data as InterestRow[]) ?? [];

    // Group events by shoe_id, cap at 50 per shoe.
    const allEvents = (eventsQ.data as ShoeEvent[]) ?? [];
    const eventsMap = new Map<string, ShoeEvent[]>();
    for (const ev of allEvents) {
      const arr = eventsMap.get(ev.shoe_id) ?? [];
      if (arr.length < 50) arr.push(ev);
      eventsMap.set(ev.shoe_id, arr);
    }
    eventsByShoe = Object.fromEntries(eventsMap);

    if (paymentsEnabled) {
      const paymentsQ = await db
        .from("payments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      recentPayments = (paymentsQ.data as Payment[]) ?? [];
    }
  }

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const interestsByShoe = new Map<
    string,
    Array<InterestRow & { email: string | null }>
  >();
  for (const row of interests) {
    const enriched = {
      ...row,
      email: profileById.get(row.user_id)?.email ?? null,
    };
    const arr = interestsByShoe.get(row.shoe_id) ?? [];
    arr.push(enriched);
    interestsByShoe.set(row.shoe_id, arr);
  }

  // Compute staleness server-side so the dashboard can render the banner + badges.
  const now = new Date();
  const staleShoeIds: string[] = [];
  const staleAgeDaysById: Record<string, number> = {};
  for (const s of shoes) {
    if (isStale(s, now)) {
      staleShoeIds.push(s.id);
      staleAgeDaysById[s.id] = staleAgeDays(s, now);
    }
  }

  return (
    <AdminDashboard
      me={session.email ?? ""}
      role={role}
      shoes={shoes}
      profiles={profiles}
      interestsByShoe={Object.fromEntries(interestsByShoe)}
      eventsByShoe={eventsByShoe}
      staleShoeIds={staleShoeIds}
      staleAgeDaysById={staleAgeDaysById}
      recentPayments={recentPayments}
      paymentsEnabled={paymentsEnabled}
    />
  );
}
