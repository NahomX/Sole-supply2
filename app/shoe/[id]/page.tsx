import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseService, type Shoe } from "@/lib/supabase";
import { getSessionInfo } from "@/lib/auth";
import { customerLabel } from "@/lib/labels";
import { sizeGridFromSizes, sizeGrid, type SizeGridEntry } from "@/lib/sizes";
import { InterestButton } from "@/components/InterestButton";
import { ProductGallery } from "@/components/ProductGallery";
import { SizeGrid } from "@/components/SizeGrid";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ETHIOPIC_FONT =
  "var(--font-ethiopic), 'Abyssinica SIL', 'Nyala', sans-serif";

async function getShoe(id: string): Promise<Shoe | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const db = supabaseService();
  const { data } = await db
    .from("shoes")
    .select("*, shoe_sizes(*), shoe_variants(*), shoe_images(*)")
    .eq("id", id)
    .is("removed_at", null)
    .maybeSingle();
  return (data as Shoe) ?? null;
}

// Same server-side redaction boundary as the homepage: shoe.url (procurement
// source) and price_usd (US purchase price) are admin-only and must never
// reach the non-admin RSC payload. price_etb and video_url are public.
function redactForViewer(s: Shoe, isAdmin: boolean): Shoe {
  return isAdmin ? s : { ...s, url: "", price_usd: null };
}

/** "18500" -> "birr 18,500" — admin-set birr price; no USD in customer UI. */
function formatEtb(priceEtb: number): string {
  return `ብር ${Number(priceEtb).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

/** Listed grid entries (shoe_sizes rows preferred; legacy free-text fallback). */
function listedEntries(shoe: Shoe): SizeGridEntry[] {
  if (shoe.shoe_sizes && shoe.shoe_sizes.length > 0) {
    return sizeGridFromSizes(shoe.shoe_sizes).filter((e) => e.available);
  }
  return sizeGrid(shoe.sizes).filter((e) => e.available);
}

export default async function ShoeDetailsPage({
  params,
}: {
  params: { id: string };
}) {
  const [shoeRaw, session] = await Promise.all([
    getShoe(params.id),
    getSessionInfo(),
  ]);
  if (!shoeRaw) notFound();

  const isAdmin = session?.profile?.role === "admin";
  const shoe = redactForViewer(shoeRaw, isAdmin);

  let alreadyRequested = false;
  if (session) {
    const db = supabaseService();
    const { data } = await db
      .from("interests")
      .select("id")
      .eq("shoe_id", shoe.id)
      .eq("user_id", session.userId)
      .limit(1);
    alreadyRequested = (data ?? []).length > 0;
  }

  const section = customerLabel(shoe).section;
  const isComingSoon = section === "coming-soon";
  const pill =
    section === "in-stock"
      ? { text: "In stock", className: "bg-emerald-900/40 text-emerald-400" }
      : section === "on-the-way"
      ? { text: "On the way", className: "bg-amber-900/40 text-amber-400" }
      : section === "previously"
      ? { text: "Sold", className: "bg-neutral-800 text-neutral-400" }
      : { text: "Coming soon", className: "bg-neutral-800/50 text-neutral-400" };

  const entries = listedEntries(shoe);
  const requestableSizes = entries
    .filter((e) => e.customerState !== "sold-out")
    .map((e) => e.us);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-7 py-10 md:py-14">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[13.5px] font-bold text-th-muted hover:text-white transition-colors"
      >
        &larr; Back to the drop
      </Link>

      <div className="mt-6 grid lg:grid-cols-2 gap-8 lg:gap-12 items-start">
        {/* ----- Media column ----- */}
        <div>
          <ProductGallery
            fallbackImageUrl={shoe.image_url}
            images={shoe.shoe_images ?? []}
            variants={shoe.shoe_variants ?? []}
            title={shoe.title}
            statusPill={pill}
          />

          {/* Hands-on video — only when an admin attached one (video_url). */}
          {shoe.video_url && (
            <div className="mt-5">
              <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-th-muted mb-2">
                Hands-on video &middot;{" "}
                <span
                  lang="am"
                  className="normal-case tracking-normal"
                  style={{ fontFamily: ETHIOPIC_FONT }}
                >
                  እውነተኛውን ጫማ ይመልከቱ
                </span>
              </p>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                src={shoe.video_url}
                controls
                playsInline
                preload="metadata"
                className="w-full rounded-[20px] border border-th-border bg-ink"
              />
            </div>
          )}
        </div>

        {/* ----- Details column ----- */}
        <div>
          {shoe.brand && (
            <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-th-muted">
              {shoe.brand}
            </div>
          )}
          {/* FULL model name — the homepage cards only show the general category. */}
          <h1 className="font-display font-bold tracking-tight leading-tight text-[clamp(26px,3.5vw,42px)] mt-2">
            {shoe.title}
          </h1>

          {/* Price — admin-set birr price when set, contact link otherwise.
              NO USD here: price_usd is stripped server-side for non-admins. */}
          <div className="mt-5">
            {shoe.price_etb != null ? (
              <div className="font-display text-2xl font-bold">
                {formatEtb(shoe.price_etb)}
              </div>
            ) : (
              <Link
                href="/#visit"
                className="inline-flex items-center text-[13px] font-extrabold border-[1.5px] border-th-border hover:border-white/60 rounded-full px-4 py-2 bg-surface-2 text-th-muted"
              >
                Contact for price
              </Link>
            )}
          </div>

          {/* Per-size availability — interactive client grid */}
          {entries.length > 0 ? (
            <div className="mt-7">
              <SizeGrid entries={entries} isComingSoon={isComingSoon} />
            </div>
          ) : shoe.sizes && shoe.sizes.trim() ? (
            <p className="mt-7 text-sm text-th-muted italic">
              Sizes TBA &middot;{" "}
              <span lang="am" style={{ fontFamily: ETHIOPIC_FONT }}>
                መጠን በቅርቡ
              </span>
            </p>
          ) : null}

          {/* Notes / description */}
          {shoe.notes && shoe.notes.trim() && (
            <p className="mt-7 text-[15px] leading-relaxed text-th-muted max-w-prose whitespace-pre-line">
              {shoe.notes}
            </p>
          )}

          <div className="mt-9">
            <InterestButton
              shoeId={shoe.id}
              sold={shoe.status === "sold"}
              signedIn={!!session}
              alreadyRequested={alreadyRequested}
              sizeOptions={requestableSizes}
            />
          </div>

          {/* Pay-on-pickup reassurance (mirrors the How-it-works band). */}
          {shoe.status !== "sold" && (
            <p className="mt-4 text-[13px] text-th-muted">
              No card needed — pay on pickup in Addis Ababa, cash or Telebirr.
            </p>
          )}

          {/* Admin-only: procurement source + US price. Both are blanked /
              nulled server-side for everyone else (redactForViewer). */}
          {isAdmin && (shoe.url || shoe.price_usd != null) && (
            <div className="mt-8 border-t border-th-border pt-4 text-[13px] text-th-muted space-y-1">
              <p className="font-bold uppercase tracking-[0.1em] text-[11px]">
                Admin
              </p>
              {shoe.price_usd != null && <p>US price: ${shoe.price_usd}</p>}
              {shoe.url && (
                <a
                  href={shoe.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-blue-400 hover:underline"
                >
                  Producer site &rarr;
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
