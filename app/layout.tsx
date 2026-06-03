import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { AuthNav } from "@/components/AuthNav";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Berebaso",
  description: "Curated sneakers, coming soon to Addis Ababa.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans min-h-screen flex flex-col">
        <header className="border-b border-neutral-200">
          <div className="max-w-6xl mx-auto px-4 py-5 flex items-center justify-between">
            {/*
              Bilingual logo lockup: Latin "Berebaso" is the primary wordmark
              (doubles as the social/domain handle). Amharic "በረባሶ" sits beside
              it at a slightly smaller size for bilingual brand recognition.
              NOTE: the Amharic spelling "በረባሶ" is a best-effort transliteration
              of "Berebaso" — the owner (a native Amharic speaker) must verify
              and approve this spelling before launch. See PR description.
            */}
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-xl font-semibold tracking-tight">Berebaso</span>
              <span
                lang="am"
                className="text-base font-medium text-neutral-500"
                style={{ fontFamily: "'Noto Sans Ethiopic', 'Abyssinica SIL', 'Nyala', sans-serif", lineHeight: 1.4 }}
              >
                በረባሶ
              </span>
            </Link>
            <AuthNav />
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-neutral-200 text-sm text-neutral-500">
          <div className="max-w-6xl mx-auto px-4 py-6">
            Berebaso · Addis Ababa, Ethiopia
          </div>
        </footer>
      </body>
    </html>
  );
}
