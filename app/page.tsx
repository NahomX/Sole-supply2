import { supabaseServer, type Shoe } from "@/lib/supabase";
import { ShoeCard } from "@/components/ShoeCard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getShoes(): Promise<Shoe[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return [];
  const db = supabaseServer();
  const { data } = await db
    .from("shoes")
    .select("*")
    .order("created_at", { ascending: false });
  return (data as Shoe[]) ?? [];
}

export default async function HomePage() {
  const shoes = await getShoes();
  const active = shoes.filter((s) => s.status !== "sold");
  const sold = shoes.filter((s) => s.status === "sold");

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <section className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">Coming soon</h1>
        <p className="text-neutral-600 mt-2 max-w-2xl">
          A preview of sneakers we&apos;re lining up for the Addis Ababa shop. No
          orders yet — just a peek at what&apos;s on the way.
        </p>
      </section>

      {active.length === 0 ? (
        <div className="text-neutral-500 text-sm">
          Nothing to show yet — check back soon.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {active.map((s) => (
            <ShoeCard key={s.id} shoe={s} />
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
              <ShoeCard key={s.id} shoe={s} dim />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
