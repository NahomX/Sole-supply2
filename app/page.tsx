import { supabaseService, type Shoe } from "@/lib/supabase";
import { getSessionInfo } from "@/lib/auth";
import { ShoeCard } from "@/components/ShoeCard";
import { customerLabel } from "@/lib/labels";
import Link from "next/link";

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
    titleAm,
    items,
    id,
    dim = false,
  }: {
    title: string;
    titleAm: string;
    items: Shoe[];
    id?: string;
    dim?: boolean;
  }) {
    if (items.length === 0) return null;
    return (
      <section className="mb-16" id={id}>
        <div className="flex items-start gap-3 mb-5">
          {/* Amber accent bar — ties sections to the hero palette */}
          <span className="mt-1 w-1.5 h-5 rounded bg-amber-600 flex-shrink-0" />
          <div>
            <h2 className="text-lg font-semibold text-neutral-800 leading-tight">
              {title}
            </h2>
            {/* Amharic subtitle — NOTE: must be verified by native speaker */}
            <p
              lang="am"
              className="text-sm text-neutral-500 mt-0.5"
              style={{ fontFamily: "'Noto Sans Ethiopic', 'Abyssinica SIL', 'Nyala', sans-serif", lineHeight: 1.45 }}
            >
              {titleAm}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 md:gap-6">
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
    <div className="max-w-6xl mx-auto px-4 py-12 md:py-16">

      {/*
        =========================================================
        HERO BAND
        =========================================================
        Full-bleed within the container, rounded-2xl, ~360px desktop.
        Layers (back to front):
          1. Brand gradient: espresso → coffee → amber (diagonal)
          2. Radial-dot texture overlay for depth (inline CSS, zero requests)
          3. Content: bilingual lockup + tagline + browse CTA

        PLACEHOLDER WARNING: No external image is used here — the CSS-gradient
        hero is the safe default. To add a hero photo, insert a next/image with
        explicit width/height and priority, pinned right, with a left-to-right
        dark scrim, and add images.unsplash.com (or your own domain) to
        next.config.js remotePatterns. Replace with owned photography before launch.

        AMHARIC NOTE: All Amharic strings below are best-effort transliterations
        and translations. They MUST be reviewed and approved by the owner
        (a native Amharic speaker) before going live. See PR description.
      */}
      <section
        className="relative overflow-hidden rounded-2xl mb-16"
        style={{
          minHeight: "320px",
          background: "linear-gradient(120deg, #2A1A12 0%, #3E2A1C 45%, #C8742B 100%)",
        }}
        aria-label="Berebaso hero"
      >
        {/* Subtle radial-dot texture overlay — zero network requests */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.07) 1px, transparent 0)",
            backgroundSize: "22px 22px",
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center h-full px-8 py-12 md:px-14 md:py-16 max-w-2xl">
          {/* Bilingual brand lockup */}
          <div className="mb-6">
            {/*
              Amharic "በረባሶ" as the dominant hero line for the Addis audience.
              Latin "Berebaso" as a secondary supporting line.
              The owner must confirm the correct fidel spelling before launch.
            */}
            <p
              lang="am"
              className="font-bold text-white leading-tight mb-1"
              style={{
                fontSize: "clamp(2.5rem, 6vw, 4rem)",
                fontFamily: "'Noto Sans Ethiopic', 'Abyssinica SIL', 'Nyala', sans-serif",
                lineHeight: 1.3,
              }}
            >
              በረባሶ
            </p>
            <p className="text-white/70 text-xl font-semibold tracking-tight">
              Berebaso
            </p>
          </div>

          {/* Bilingual tagline */}
          <div className="mb-8 space-y-1">
            {/*
              Amharic primary tagline for Addis audience.
              English secondary line for clarity / bilingual parity.
            */}
            <p
              lang="am"
              className="text-white font-medium text-lg"
              style={{ fontFamily: "'Noto Sans Ethiopic', 'Abyssinica SIL', 'Nyala', sans-serif", lineHeight: 1.45 }}
            >
              ከአሜሪካ የመጡ አዳዲስ ጫማዎች፣ በቀጥታ ወደ አዲስ አበባ
            </p>
            <p className="text-white/70 text-sm max-w-md">
              Fresh sneakers from the US, straight to Addis.{" "}
              {session
                ? "Tap a shoe you want — we'll reach out when it's in stock."
                : "Sign in from the header to reserve yours."}
            </p>
          </div>

          {/* Amber CTA pill — anchors to the in-stock section */}
          {hasAny && (
            <Link
              href="#in-stock"
              className="inline-flex self-start items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white"
              style={{ backgroundColor: "#C8742B" }}
            >
              Browse the drop
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
              >
                <path
                  d="M2 7h10M8 3l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          )}
        </div>
      </section>

      {/* Empty state — friendlier card with inline SVG sneaker outline */}
      {!hasAny && (
        <div className="bg-neutral-50 rounded-xl p-10 flex flex-col items-center gap-4 text-center">
          {/* Inline SVG sneaker outline — zero network request, scales crisply */}
          <svg
            aria-hidden="true"
            width="64"
            height="64"
            viewBox="0 0 64 64"
            fill="none"
            className="text-neutral-300"
          >
            <path
              d="M8 44c0 0 4-8 12-10l8-2 6-8 10 4 4-4 8 6v8c0 2-2 4-4 4H12c-2 0-4-2-4-4z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path
              d="M20 32l4 6M28 30l2 8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <div>
            <p className="text-neutral-600 font-medium">Nothing to show yet</p>
            <p className="text-neutral-400 text-sm mt-1">Check back soon — the next drop is coming.</p>
          </div>
        </div>
      )}

      <div className="scroll-mt-24" id="in-stock" />
      <Section title="Available now" titleAm="አሁን ዝግጁ" items={inStock} id="in-stock" />
      <Section title="On the way" titleAm="በመንገድ ላይ" items={onTheWay} />
      <Section title="Coming soon" titleAm="በቅርቡ ይመጣል" items={comingSoon} />
      <Section title="Previously" titleAm="ቀደም ሲል የነበሩ" items={previously} dim />
    </div>
  );
}
