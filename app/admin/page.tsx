import { redirect } from "next/navigation";
import { getSessionInfo } from "@/lib/auth";
import { supabaseService, type Shoe, type Profile } from "@/lib/supabase";
import { AdminDashboard } from "./AdminDashboard";

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
  if (session.profile?.role !== "admin") {
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
  const [shoesQ, profilesQ, interestsQ] = await Promise.all([
    db.from("shoes").select("*").order("created_at", { ascending: false }),
    db.from("profiles").select("*").order("created_at", { ascending: false }),
    db.from("interests").select("*").order("created_at", { ascending: false }),
  ]);

  const shoes = (shoesQ.data as Shoe[]) ?? [];
  const profiles = (profilesQ.data as Profile[]) ?? [];
  const interests = (interestsQ.data as InterestRow[]) ?? [];

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

  return (
    <AdminDashboard
      me={session.email ?? ""}
      shoes={shoes}
      profiles={profiles}
      interestsByShoe={Object.fromEntries(interestsByShoe)}
    />
  );
}
