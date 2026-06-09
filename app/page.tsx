import { supabaseService, type Shoe } from "@/lib/supabase";
import { getSessionInfo } from "@/lib/auth";
import { ShoeCard } from "@/components/ShoeCard";
import { shoeSection } from "@/lib/labels";
import { getSiteCopy, getCopy } from "@/lib/site-copy";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getShoes(): Promise<Shoe[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return [];
  const db = supabaseService();
  // Join shoe_sizes so shoeSection() can compute the best section from
  // per-size logistics statuses (Phase 1).
  // Hide soft-removed shoes from the storefront (removed via the site-edit bot).
  const { data } = await db
    .from("shoes")
    .select("*, shoe_sizes(*)")
    .is("removed_at", null)
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
  const [shoesRaw, session, copy] = await Promise.all([
    getShoes(),
    getSessionInfo(),
    getSiteCopy(),
  ]);
  const interested = session
    ? await getMyInterestShoeIds(session.userId)
    : new Set<string>();
  const isAdmin = session?.profile?.role === "admin";
  const shoes = shoesRaw.map((s) => redactForViewer(s, isAdmin));

  // Split into sections using shoeSection(), which uses per-size logistics status.
  const inStock = shoes.filter((s) => shoeSection(s) === "in-stock");
  const onTheWay = shoes.filter((s) => shoeSection(s) === "on-the-way");
  const comingSoon = shoes.filter((s) => shoeSection(s) === "coming-soon");
  const previously = shoes.filter((s) => shoeSection(s) === "previously");

  const hasAny = shoes.length > 0;

  // The hero "Browse the drop" CTA should anchor to the first NON-EMPTY section
  // so it never scrolls to blank space when "In stock" happens to be empty.
  function firstNonEmptySection() {
    if (inStock.length > 0) return "#in-stock";
    if (onTheWay.length > 0) return "#on-the-way";
    if (comingSoon.length > 0) return "#coming-soon";
    return "#previously";
  }

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
      // id + scroll-mt-24 live on the actual <section> element — no phantom div needed.
      <section className="mb-16 scroll-mt-24" id={id}>
        <div className="flex items-start gap-3 mb-5">
          {/* Amber accent bar — ties sections to the hero palette */}
          <span className="mt-1 w-1.5 h-5 rounded bg-amber-600 flex-shrink-0" />
          <div>
            <h2 className="text-lg font-semibold text-neutral-800 leading-tight">
              {title}
            </h2>
            {/*
              Amharic subtitle — owner to verify remaining Amharic copy
              (hero tagline + the four section subtitles) with a native speaker.
            */}
            <p
              lang="am"
              className="text-sm text-neutral-500 mt-0.5"
              style={{ fontFamily: "var(--font-ethiopic), 'Abyssinica SIL', 'Nyala', sans-serif", lineHeight: 1.45 }}
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
          3. Left-to-right dark scrim — keeps white text legible over the bright
             amber end of the gradient (without this, text-white/70 fails WCAG AA
             contrast on the amber side). The scrim fades out rightward so the
             amber colour still shows on wide screens.
          4. Content: bilingual lockup + tagline + browse CTA

        PLACEHOLDER WARNING: No external image is used here — the CSS-gradient
        hero is the safe default. To add a hero photo, insert a next/image with
        explicit width/height and priority, pinned right, with a left-to-right
        dark scrim, and add images.unsplash.com (or your own domain) to
        next.config.js remotePatterns. Replace with owned photography before launch.

        AMHARIC NOTE: Hero tagline and section subtitles are best-effort translations
        — owner to verify remaining Amharic copy with a native speaker before launch.
        Brand spelling "በረባሶ" is confirmed correct by the owner.
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

        {/*
          Dark scrim: fades from semi-opaque black on the left (where the text
          column sits) to transparent on the right. This ensures white copy has
          enough contrast over the amber terminal stop without killing the amber
          colour entirely. Contrast checked: text-white/90 over rgba(0,0,0,0.45)
          blended with #3E2A1C ≈ 7:1, well above AA (4.5:1).
        */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "linear-gradient(to right, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.20) 55%, rgba(0,0,0,0) 100%)",
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center h-full px-8 py-12 md:px-14 md:py-16 max-w-2xl">
          {/* Bilingual brand lockup */}
          <div className="mb-6">
            {/*
              Amharic "በረባሶ" as the dominant hero line for the Addis audience.
              Latin "Berebaso" as a secondary supporting line.
              Brand spelling confirmed correct by the owner (native speaker).
            */}
            <p
              lang="am"
              className="font-bold text-white leading-tight mb-1"
              style={{
                fontSize: "clamp(2.5rem, 6vw, 4rem)",
                fontFamily: "var(--font-ethiopic), 'Abyssinica SIL', 'Nyala', sans-serif",
                lineHeight: 1.3,
              }}
            >
              በረባሶ
            </p>
            <p className="text-white/90 text-xl font-semibold tracking-tight">
              Berebaso
            </p>
          </div>

          {/* Bilingual tagline — owner to verify remaining Amharic copy */}
          <div className="mb-8 space-y-1">
            <p
              lang="am"
              className="text-white/90 font-medium text-lg"
              style={{ fontFamily: "var(--font-ethiopic), 'Abyssinica SIL', 'Nyala', sans-serif", lineHeight: 1.45 }}
            >
              {getCopy(copy, "hero_tagline", "am")}
            </p>
            <p className="text-white/90 text-sm max-w-md">
              {getCopy(copy, "hero_tagline", "en")}{" "}
              {session
                ? "Tap a shoe you want — we'll reach out when it's in stock."
                : "Sign in from the header to reserve yours."}
            </p>
          </div>

          {/* Amber CTA pill — anchors to first non-empty section */}
          {hasAny && (
            <Link
              href={firstNonEmptySection()}
              className="inline-flex self-start items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-amber text-white hover:bg-brand-coffee focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white transition-colors"
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

      {/*
        Sections — id + scroll-mt-24 are on the <section> element inside Section{}.
        The standalone phantom <div id="in-stock" /> has been removed; there was
        a duplicate id="in-stock" that caused browsers to anchor to the empty div
        instead of the actual section, potentially scrolling to nothing when
        "In stock" is empty.
      */}
      <Section title={getCopy(copy, "section_available", "en")} titleAm={getCopy(copy, "section_available", "am")} items={inStock} id="in-stock" />
      <Section title={getCopy(copy, "section_on_the_way", "en")} titleAm={getCopy(copy, "section_on_the_way", "am")} items={onTheWay} id="on-the-way" />
      <Section title={getCopy(copy, "section_coming_soon", "en")} titleAm={getCopy(copy, "section_coming_soon", "am")} items={comingSoon} id="coming-soon" />
      <Section title={getCopy(copy, "section_previously", "en")} titleAm={getCopy(copy, "section_previously", "am")} items={previously} id="previously" dim />
    </div>
  );
}
