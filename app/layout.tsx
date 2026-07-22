import type { Metadata } from "next";
import { Inter, Noto_Sans_Ethiopic, Unbounded } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { AuthNav } from "@/components/AuthNav";
import { MobileNav } from "@/components/MobileNav";
import { getSiteCopy, getCopy } from "@/lib/site-copy";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

// Load Noto Sans Ethiopic as a real webfont so "በረባሶ" and all Amharic CTAs
// render correctly on iOS, Android, and any device without a system Ethiopic
// font installed. Without this, those browsers show "tofu" (empty boxes).
// Nyala / Abyssinica SIL remain as CSS fallbacks in tailwind.config.ts.
const ethiopic = Noto_Sans_Ethiopic({
  subsets: ["ethiopic"],
  weight: ["400", "500", "700"],
  variable: "--font-ethiopic",
  display: "swap",
});

// Unbounded — the redesign's display face (wordmark, headings, prices, stats,
// marquee). Exposed as --font-display → Tailwind `font-display`.
const unbounded = Unbounded({
  subsets: ["latin"],
  weight: ["500", "700", "900"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Berebaso",
    template: "%s | Berebaso",
  },
  description: "US sneakers, straight to Addis Ababa. Hand-picked, 100% authentic, no fakes ever.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://berebaso.vercel.app"),
  openGraph: {
    title: "Berebaso",
    description: "US sneakers, straight to Addis Ababa. Hand-picked, 100% authentic.",
    siteName: "Berebaso",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Berebaso",
    description: "US sneakers, straight to Addis Ababa.",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const copy = await getSiteCopy();
  return (
    <html
      lang="en"
      className={`${inter.variable} ${ethiopic.variable} ${unbounded.variable}`}
    >
      <body className="font-sans min-h-screen flex flex-col">
        {/*
          Sticky dark header (mockup): ink glass bar, BEREBASO በረባሶ wordmark,
          anchor nav. Anchors are "/#..." (not "#...") because this header also
          renders on /submit, /admin, /auth/* and /shoe/[id].
          AuthNav is shared and untouched — .nav-auth (app/globals.css) recolors
          its light-background text classes for the dark bar.
        */}
        <header className="sticky top-0 z-50 bg-[#0c0c0c]/95 text-cream backdrop-blur-md border-b border-white/10">
          <div className="max-w-7xl mx-auto px-4 md:px-7 py-4 flex items-center gap-6">
            {/*
              Bilingual wordmark: Latin "BEREBASO" in the display face, Amharic
              "በረባሶ" beside it in accent amber.
              Brand spelling "በረባሶ" confirmed correct by the owner (native speaker).
            */}
            <Link href="/" className="flex items-baseline gap-2.5 shrink-0">
              <span className="font-display text-lg font-black tracking-wide">
                BEREBASO
              </span>
              <span
                lang="am"
                className="text-accent-amber text-[15px] font-semibold"
                style={{
                  fontFamily:
                    "var(--font-ethiopic), 'Abyssinica SIL', 'Nyala', sans-serif",
                  lineHeight: 1.4,
                }}
              >
                በረባሶ
              </span>
            </Link>
            <nav className="hidden md:flex items-center gap-5 ml-auto text-[13.5px] font-semibold">
              <Link href="/#in-stock" className="text-cream/70 hover:text-cream">
                In stock
              </Link>
              <Link href="/#on-the-way" className="text-cream/70 hover:text-cream">
                On the way
              </Link>
              <Link href="/#coming-soon" className="text-cream/70 hover:text-cream">
                Coming soon
              </Link>
              <Link href="/#how" className="text-cream/70 hover:text-cream">
                How it works
              </Link>
              <Link href="/#visit" className="text-cream/70 hover:text-cream">
                Visit us
              </Link>
            </nav>
            <MobileNav />
            <div className="nav-auth ml-auto md:ml-0">
              <AuthNav />
            </div>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        {/* Dark footer (mockup) — keeps the editable site-copy "footer" key. */}
        <footer className="bg-[#050505] text-cream/55 border-t border-white/10 text-[13px]">
          <div className="max-w-7xl mx-auto px-4 md:px-7 py-8 flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-baseline gap-2">
              <span className="font-display text-sm font-bold text-cream">
                BEREBASO
              </span>
              <span
                lang="am"
                className="text-accent-amber"
                style={{
                  fontFamily:
                    "var(--font-ethiopic), 'Abyssinica SIL', 'Nyala', sans-serif",
                  lineHeight: 1.4,
                }}
              >
                በረባሶ
              </span>
            </span>
            <span>{getCopy(copy, "footer", "en")} · US-authentic sneakers</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
