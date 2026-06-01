import { supabaseService, type Shoe } from "@/lib/supabase";
import { getSessionInfo } from "@/lib/auth";
import { ShoeCard } from "@/components/ShoeCard";
import { customerLabel } from "@/lib/labels";

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

// shoe.url is the procurement source — admins only. Strip it from the
// payload sent to non-admin clients so it never lands in the HTML/RSC
// stream where dev-tools or view-source would expose it. The UI hides
// the link too, but server-side redaction is the actual security boundary.
function redactForViewer(s: Shoe, isAdmin: boolean): Shoe {
  return isAdmin ? s : { ...s, url: "" };
}

export default async function HomePage() {
  const [shoesRaw, session] = await Promise.all([getShoes(), getSessionInfo()]);
  const interested = session
    ? await getMyInterestShoeIds(session.userId)
    : new Set<string>();
  const isAdmin = session?.profile?.role === "admin";
  const shoes = shoesRaw.map((s) => redactForViewer(s, isAdmin));

  // Split into sections per the customer label mapping.
  const inStock = shoes.filter((s) => customerLabel(s).section === "in-stock");
  const onTheWay = shoes.filter(
    (s) => customerLabel(s).section === "on-the-way"
  );
  const comingSoon = shoes.filter(
    (s) => customerLabel(s).section === "coming-soon"
  );
  const previously = shoes.filter(
    (s) => customerLabel(s).section === "previously"
  );

  const hasAny = shoes.length > 0;

  function Section({
    title,
    items,
    dim = false,
  }: {
    title: string;
    items: Shoe[];
    dim?: boolean;
  }) {
    if (items.length === 0) return null;
    return (
      <section className="mb-14">
        <h2 className="text-lg font-medium text-neutral-700 mb-4">{title}</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((s) => (
            <ShoeCard
              key={s.id}
              shoe={s}
              signedIn={!!session}
              isAdmin={isAdmin}
              alreadyRequested={interested.has(s.id)}
              dim={dim}
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <section className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">Sole Supply</h1>
        <p className="text-neutral-600 mt-2 max-w-2xl">
          Sneakers from the US, delivered to Addis Ababa.
          {session
            ? " Tap a shoe you want — we'll reach out when it's in stock."
            : " Sign in from the header to request the ones you want."}
        </p>
      </section>

      {!hasAny && (
        <div className="text-neutral-500 text-sm">
          Nothing to show yet — check back soon.
        </div>
      )}

      <Section title="In stock" items={inStock} />
      <Section title="On the way" items={onTheWay} />
      <Section title="Coming soon" items={comingSoon} />
      <Section title="Previously" items={previously} dim />
    </div>
  );
}
