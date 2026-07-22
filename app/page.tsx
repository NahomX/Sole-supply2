import { supabaseService, type Shoe } from "@/lib/supabase";
import { getSessionInfo } from "@/lib/auth";
import { ShoeCard } from "@/components/ShoeCard";
import { ShoeImage } from "@/components/ShoeImage";
import { shoeSection } from "@/lib/labels";
import { parseAvailableSizes } from "@/lib/sizes";
import { categoryFromTitle } from "@/components/shoe-category";
import { getSiteCopy, getCopy } from "@/lib/site-copy";
import { contact } from "@/lib/contact";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ETHIOPIC_FONT =
  "var(--font-ethiopic), 'Abyssinica SIL', 'Nyala', sans-serif";

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

// shoe.url is the procurement source and price_usd is the US purchase price —
// both admin-only. Strip them from the payload sent to non-admin clients so
// they never land in the HTML/RSC stream where dev-tools or view-source would
// expose them. The UI hides them too, but server-side redaction is the actual
// security boundary. price_etb and video_url are public — pass through.
function redactForViewer(s: Shoe, isAdmin: boolean): Shoe {
  return isAdmin ? s : { ...s, url: "", price_usd: null };
}

/** Collect the set of customer-relevant US sizes for one shoe (non-delivered
 *  shoe_sizes rows, with the legacy free-text fallback). */
function shoeUsSizes(s: Shoe): string[] {
  if (s.shoe_sizes && s.shoe_sizes.length > 0) {
    return s.shoe_sizes
      .filter((sz) => sz.logistics_status !== "delivered")
      .map((sz) => sz.us_size);
  }
  return Array.from(parseAvailableSizes(s.sizes));
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

  // ----- Hero stats, computed from real data -----
  const liveShoes = [...inStock, ...onTheWay, ...comingSoon];
  const sizeSet = new Set<string>();
  for (const s of liveShoes) for (const us of shoeUsSizes(s)) sizeSet.add(us);
  const sizeNums = Array.from(sizeSet)
    .map((us) => parseFloat(us))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const sizeRange =
    sizeNums.length === 0
      ? null
      : sizeNums[0] === sizeNums[sizeNums.length - 1]
      ? `${sizeNums[0]}`
      : `${sizeNums[0]}–${sizeNums[sizeNums.length - 1]}`;

  // Marquee items: general categories of live pairs (mockup fallback when empty).
  const categories = Array.from(
    new Set(liveShoes.map((s) => categoryFromTitle(s.title).toUpperCase()))
  );
  const marqueeItems =
    categories.length > 0
      ? categories
      : ["AIR JORDAN 1", "AIR FORCE 1", "AIR MAX 90", "NIKE SB", "KOBE AF1"];

  // Hero side shot: the freshest live pair with an image.
  const heroShoe = liveShoes.find((s) => s.image_url) ?? null;
  const heroShoeTag = heroShoe
    ? shoeSection(heroShoe) === "in-stock"
      ? "Just landed ✈"
      : shoeSection(heroShoe) === "on-the-way"
      ? "On the way ✈"
      : "Coming soon"
    : null;

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
    count,
    items,
    id,
    dim = false,
  }: {
    title: string;
    titleAm: string;
    /** Right-aligned pill text, e.g. "5 pairs · pick up today". */
    count?: string;
    items: Shoe[];
    id?: string;
    dim?: boolean;
  }) {
    if (items.length === 0) return null;
    return (
      // id + scroll-mt live on the actual <section> element — no phantom div needed
      // (a duplicate id once broke anchor scrolling; don't reintroduce one).
      <section className="pt-16 pb-2 scroll-mt-20" id={id}>
        <div className="flex items-end justify-between gap-5 mb-8">
          <div>
            <h2 className="font-display font-bold tracking-tight text-[clamp(24px,3vw,36px)]">
              {title}
            </h2>
            {/*
              Amharic subtitle — owner to verify remaining Amharic copy
              (hero tagline + the four section subtitles) with a native speaker.
            */}
            <p
              lang="am"
              className="text-[15px] font-semibold text-[var(--color-accent)] mt-2"
              style={{ fontFamily: ETHIOPIC_FONT, lineHeight: 1.45 }}
            >
              {titleAm}
            </p>
          </div>
          {count && (
            <span className="hidden sm:inline-block text-[13px] font-bold text-th-muted border border-th-border bg-surface-2 px-4 py-2 rounded-full whitespace-nowrap">
              {count}
            </span>
          )}
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
    <div>
      {/*
        =========================================================
        HERO — full-bleed ink band with radial orange glow
        (mockup .hero), Unbounded headline, bilingual subline,
        CTAs and a stats row computed from real inventory.
        =========================================================
      */}
      <section
        className="relative overflow-hidden bg-gradient-to-br from-[#1a0000] via-[#0a0a0a] to-[#0a0a0a] text-white"
        aria-label="Berebaso hero"
      >
        {/* Radial red glow (dark theme hero) */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(600px at 20% 40%, var(--color-accent-glow), transparent 70%)",
          }}
        />
        <div className="relative max-w-7xl mx-auto px-4 md:px-7 pt-16 pb-20 md:pt-20 md:pb-24 grid lg:grid-cols-[1.15fr_0.85fr] gap-10 items-center">
          <div>
            <span className="inline-flex items-center gap-2.5 border border-[var(--color-accent)]/40 text-[var(--color-accent)] text-xs font-bold tracking-[0.14em] uppercase px-4 py-2 rounded-full mb-7">
              <span
                aria-hidden="true"
                className="w-[7px] h-[7px] rounded-full bg-accent-green shadow-[0_0_0_4px_rgba(30,158,90,0.25)]"
              />
              New pairs land every week
            </span>
            <h1 className="font-display font-black leading-[1.04] tracking-tight text-[clamp(38px,5vw,68px)]">
              US sneakers,
              <br />
              straight to <span className="text-[var(--color-accent)]">Addis</span>.
            </h1>
            {/* Amharic subline — editable via the Telegram site-edit bot (hero_tagline). */}
            <p
              lang="am"
              className="mt-4 text-accent-amber font-semibold text-[clamp(17px,2vw,22px)]"
              style={{ fontFamily: ETHIOPIC_FONT, lineHeight: 1.5 }}
            >
              {getCopy(copy, "hero_tagline", "am")}
            </p>
            <p className="mt-4 max-w-[520px] text-base leading-relaxed text-[var(--color-text-muted)]">
              {getCopy(copy, "hero_tagline", "en")} Every pair is hand-picked
              and bought in the United States, then flown to Addis Ababa. Tap
              &ldquo;I want this&rdquo; on any shoe and we hold it for you — no
              card needed up front.
            </p>
            <div className="mt-9 flex flex-wrap gap-3.5">
              {hasAny && (
                <Link
                  href={firstNonEmptySection()}
                  className="inline-flex items-center gap-2 bg-[var(--color-accent)] text-white font-extrabold text-[15px] px-7 py-4 rounded-full shadow-[0_12px_32px_var(--color-accent-glow)] hover:bg-[var(--color-accent-hover)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  Browse the drop →
                </Link>
              )}
              <Link
                href="#how"
                className="inline-flex items-center border-[1.5px] border-white/30 text-white font-bold text-[15px] px-7 py-4 rounded-full hover:border-white/60 transition-colors"
              >
                How it works
              </Link>
            </div>
            {/* Stats row — computed from real data above. */}
            <div className="mt-12 flex flex-wrap gap-8">
              <div>
                <div className="font-display text-[26px] font-bold">
                  {liveShoes.length}
                </div>
                <div className="text-xs uppercase tracking-[0.08em] text-white/50 mt-1.5">
                  Pairs live
                </div>
              </div>
              <div>
                <div className="font-display text-[26px] font-bold">
                  {inStock.length}
                </div>
                <div className="text-xs uppercase tracking-[0.08em] text-white/50 mt-1.5">
                  In stock now
                </div>
              </div>
              {sizeRange && (
                <div>
                  <div className="font-display text-[26px] font-bold">
                    {sizeRange}
                  </div>
                  <div className="text-xs uppercase tracking-[0.08em] text-white/50 mt-1.5">
                    US sizes
                  </div>
                </div>
              )}
              <div>
                <div className="font-display text-[26px] font-bold">100%</div>
                <div className="text-xs uppercase tracking-[0.08em] text-white/50 mt-1.5">
                  US-authentic
                </div>
              </div>
            </div>
          </div>
          {/* Hero shoe shot — freshest live pair; hidden when no image loads. */}
          {heroShoe && (
            <div className="relative hidden lg:flex justify-center">
              <ShoeImage
                src={heroShoe.image_url}
                alt={heroShoe.title}
                fallback="hide"
                className="w-full max-w-[520px] -rotate-12 drop-shadow-[0_20px_60px_rgba(220,38,38,0.25)]"
              />
              <div className="absolute top-[8%] right-[4%] rotate-3 bg-surface-2 text-th-text rounded-[14px] px-4 py-3 text-xs font-bold shadow-[0_14px_36px_rgba(0,0,0,0.35)]">
                {categoryFromTitle(heroShoe.title)}
                <br />
                <span className="font-display text-[15px] text-[var(--color-accent)]">
                  {heroShoeTag}
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Orange marquee strip — general categories of live pairs. */}
      <div
        className="bg-accent text-white overflow-hidden whitespace-nowrap py-3 border-t border-black/10"
        aria-hidden="true"
      >
        <div className="inline-block animate-marquee font-display text-[13px] font-bold tracking-[0.18em]">
          {/* Track content rendered twice so the -50% keyframe loops seamlessly. */}
          {[0, 1].map((pass) => (
            <span key={pass}>
              {marqueeItems.map((item) => (
                <span key={`${pass}-${item}`}>
                  <span className="mx-6">{item}</span>
                  <span className="mx-6">✦</span>
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-7">
        {/* Empty state — friendlier card with inline SVG sneaker outline */}
        {!hasAny && (
          <div className="bg-surface border border-th-border rounded-[20px] my-16 p-10 flex flex-col items-center gap-4 text-center">
            <svg
              aria-hidden="true"
              width="64"
              height="64"
              viewBox="0 0 64 64"
              fill="none"
              className="text-th-muted/50"
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
              <p className="text-th-muted font-medium">Nothing to show yet</p>
              <p className="text-th-muted/70 text-sm mt-1">
                Check back soon — the next drop is coming.
              </p>
            </div>
          </div>
        )}

        {/*
          Sections — titles stay wired to the Telegram-editable site_copy keys
          (section_available / section_on_the_way / section_coming_soon /
          section_previously). Wording like "In stock — ready now" comes from
          those keys; defaults live in lib/site-copy.ts DEFAULTS. NEVER "In Addis".
        */}
        <Section
          title={getCopy(copy, "section_available", "en")}
          titleAm={getCopy(copy, "section_available", "am")}
          count={`${inStock.length} ${inStock.length === 1 ? "pair" : "pairs"} · pick up today`}
          items={inStock}
          id="in-stock"
        />
        <Section
          title={getCopy(copy, "section_on_the_way", "en")}
          titleAm={getCopy(copy, "section_on_the_way", "am")}
          count="Reserve before they land"
          items={onTheWay}
          id="on-the-way"
        />
        <Section
          title={getCopy(copy, "section_coming_soon", "en")}
          titleAm={getCopy(copy, "section_coming_soon", "am")}
          count={"Vote with “I want this” — most-wanted pairs fly first"}
          items={comingSoon}
          id="coming-soon"
        />
        <Section
          title={getCopy(copy, "section_previously", "en")}
          titleAm={getCopy(copy, "section_previously", "am")}
          items={previously}
          id="previously"
          dim
        />
      </div>

      {/* ============ HOW IT WORKS — dark band ============ */}
      <div className="bg-surface text-[var(--color-text)] mt-20 py-20 scroll-mt-20" id="how">
        <div className="max-w-7xl mx-auto px-4 md:px-7">
          <h2 className="font-display font-bold text-[clamp(24px,3vw,34px)] mb-2.5">
            How Berebaso works
          </h2>
          <p
            lang="am"
            className="text-accent-amber font-semibold mb-11"
            style={{ fontFamily: ETHIOPIC_FONT, lineHeight: 1.45 }}
          >
            በረባሶ እንዴት እንደሚሰራ
          </p>
          <div className="grid md:grid-cols-3 gap-5">
            <div className="bg-[#0f0f0f] border border-th-border rounded-[20px] p-7">
              <div className="font-display text-[34px] font-black text-accent mb-4">
                01
              </div>
              <h3 className="text-[17px] font-extrabold mb-2.5">
                We buy it in the US 🇺🇸
              </h3>
              <p className="text-sm leading-relaxed text-th-muted">
                Every pair is bought directly from US retailers — Nike, Foot
                Locker, and verified stores. No fakes, no &ldquo;AAA
                copies&rdquo;, ever.
              </p>
            </div>
            <div className="bg-[#0f0f0f] border border-th-border rounded-[20px] p-7">
              <div className="font-display text-[34px] font-black text-accent mb-4">
                02
              </div>
              <h3 className="text-[17px] font-extrabold mb-2.5">
                It flies to Addis ✈️
              </h3>
              <p className="text-sm leading-relaxed text-th-muted">
                Your pair makes its way from the US to Addis Ababa — the shoe
                card always shows where it is: in stock, on the way, or coming
                soon.
              </p>
            </div>
            <div className="bg-[#0f0f0f] border border-th-border rounded-[20px] p-7">
              <div className="font-display text-[34px] font-black text-accent mb-4">
                03
              </div>
              <h3 className="text-[17px] font-extrabold mb-2.5">
                You pick it up 🤝
              </h3>
              <p className="text-sm leading-relaxed text-th-muted">
                Tap &ldquo;I want this&rdquo; and we hold your size. Pay on
                pickup in Addis Ababa — cash or Telebirr, whatever works for
                you.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ============ VISIT / CONTACT ============ */}
      <section
        className="max-w-7xl mx-auto px-4 md:px-7 pt-16 pb-20 scroll-mt-20"
        id="visit"
      >
        <div className="mb-8">
          <h2 className="font-display font-bold tracking-tight text-[clamp(24px,3vw,36px)]">
            Find us · ask us anything
          </h2>
          <p
            lang="am"
            className="text-[15px] font-semibold text-[var(--color-accent)] mt-2"
            style={{ fontFamily: ETHIOPIC_FONT, lineHeight: 1.45 }}
          >
            ሱቃችን ይምጡ ወይም ይደውሉልን
          </p>
        </div>
        {/* Contact card values are configured via env vars (see lib/contact.ts). */}
        <div className="grid md:grid-cols-3 gap-5">
          <div className="bg-surface border border-th-border rounded-[20px] p-7">
            <div className="text-[26px] mb-3.5" aria-hidden="true">
              📍
            </div>
            <h3 className="text-base font-extrabold mb-2">The store</h3>
            <p className="text-sm leading-relaxed text-th-muted mb-3.5">
              {contact.addressEn}
              <br />
              <span lang="am" style={{ fontFamily: ETHIOPIC_FONT }}>
                {contact.addressAm}
              </span>
            </p>
            <a
              href={`https://maps.google.com/?q=${contact.mapsQuery}`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[var(--color-accent)] font-extrabold text-[13.5px] hover:underline"
            >
              Open in Maps →
            </a>
          </div>
          <div className="bg-surface border border-th-border rounded-[20px] p-7">
            <div className="text-[26px] mb-3.5" aria-hidden="true">
              📞
            </div>
            <h3 className="text-base font-extrabold mb-2">Call or text</h3>
            <p className="text-sm leading-relaxed text-th-muted mb-3.5">
              {contact.phone ? contact.phone : "Coming soon"}
              <br />
              {contact.hours}
            </p>
            {contact.phone ? (
              <a
                href={`tel:${contact.phoneTel}`}
                className="text-[var(--color-accent)] font-extrabold text-[13.5px] hover:underline"
              >
                Call now →
              </a>
            ) : (
              <span className="text-th-muted font-extrabold text-[13.5px]">
                Follow us for updates
              </span>
            )}
          </div>
          <div className="bg-surface border border-th-border rounded-[20px] p-7">
            <div className="text-[26px] mb-3.5" aria-hidden="true">
              💬
            </div>
            <h3 className="text-base font-extrabold mb-2">Telegram</h3>
            <p className="text-sm leading-relaxed text-th-muted mb-3.5">
              {contact.telegram ? "Fastest way to ask a price" : "Coming soon"}
              <br />
              {contact.telegram ? "or hold a pair" : "Follow us for updates"}
            </p>
            {contact.telegram ? (
              <a
                href={contact.telegramUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[var(--color-accent)] font-extrabold text-[13.5px] hover:underline"
              >
                Message @{contact.telegram} →
              </a>
            ) : (
              <span className="text-th-muted font-extrabold text-[13.5px]">
                Stay tuned
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
