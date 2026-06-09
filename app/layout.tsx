import type { Metadata } from "next";
import { Inter, Noto_Sans_Ethiopic } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { AuthNav } from "@/components/AuthNav";
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

export const metadata: Metadata = {
  title: "Berebaso",
  description: "Curated sneakers, coming soon to Addis Ababa.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const copy = await getSiteCopy();
  return (
    <html lang="en" className={`${inter.variable} ${ethiopic.variable}`}>
      <body className="font-sans min-h-screen flex flex-col">
        <header className="border-b border-neutral-200">
          <div className="max-w-6xl mx-auto px-4 py-5 flex items-center justify-between">
            {/*
              Bilingual logo lockup: Latin "Berebaso" is the primary wordmark
              (doubles as the social/domain handle). Amharic "በረባሶ" sits beside
              it at a slightly smaller size for bilingual brand recognition.
              Brand spelling "በረባሶ" confirmed correct by the owner (native speaker).
            */}
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-xl font-semibold tracking-tight">Berebaso</span>
              <span
                lang="am"
                className="text-base font-medium text-neutral-500"
                style={{ fontFamily: "var(--font-ethiopic), 'Abyssinica SIL', 'Nyala', sans-serif", lineHeight: 1.4 }}
              >
                በረባሶ
              </span>
            </Link>
            <AuthNav />
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-neutral-200 text-sm text-neutral-500">
          <div className="max-w-6xl mx-auto px-4 py-6 flex items-baseline gap-2">
            <span>Berebaso</span>
            <span
              lang="am"
              style={{ fontFamily: "var(--font-ethiopic), 'Abyssinica SIL', 'Nyala', sans-serif", lineHeight: 1.4 }}
            >
              በረባሶ
            </span>
            <span>· {getCopy(copy, "footer", "en")}</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
