import { supabaseService, type Shoe } from "@/lib/supabase";
import { getSessionInfo } from "@/lib/auth";
import { ShoeCard } from "@/components/ShoeCard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getShoes(): Promise<Shoe[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return [];
  const db = supabaseService();
  const { data } = await db
    .from("shoes")
    .select("*")
    .order("created_at", { ascending: false });
  return (data as Shoe[]) ?? [];
}

async function getMyInterestShoeIds(userId: string): Promise<Set<string>> {
  const db = supabaseService();
  const { data } = await db
    .from("interests")
    .select("shoe_id")
    .eq("user_id", userId);
  return new Set((data ?? []).map((r: { shoe_id: string }) => r.shoe_id));
}

export default async function HomePage() {
  const [shoes, session] = await Promise.all([getShoes(), getSessionInfo()]);
  const interested = session
    ? await getMyInterestShoeIds(session.userId)
    : new Set<string>();

  const active = shoes.filter((s) => s.status !== "sold");
  const sold = shoes.filter((s) => s.status === "sold");

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <section className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">Coming soon</h1>
        <p className="text-neutral-600 mt-2 max-w-2xl">
          A preview of sneakers we&apos;re lining up for the Addis Ababa shop.
          {session
            ? " Tap a shoe you want — we'll reach out when it's in stock."
            : " Sign in from the header to request the ones you want."}
        </p>
      </section>

      {active.length === 0 ? (
        <div className="text-neutral-500 text-sm">
          Nothing to show yet — check back soon.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {active.map((s) => (
            <ShoeCard
              key={s.id}
              shoe={s}
              signedIn={!!session}
              alreadyRequested={interested.has(s.id)}
            />
          ))}
        </div>
      )}

      {sold.length > 0 && (
        <section className="mt-16">
          <h2 className="text-lg font-medium text-neutral-500 mb-4">
            Previously
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {sold.map((s) => (
              <ShoeCard key={s.id} shoe={s} signedIn={!!session} dim />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
