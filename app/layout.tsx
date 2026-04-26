import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { AuthNav } from "@/components/AuthNav";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Sole Supply",
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
            <Link href="/" className="text-xl font-semibold tracking-tight">
              Sole Supply
            </Link>
            <AuthNav />
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-neutral-200 text-sm text-neutral-500">
          <div className="max-w-6xl mx-auto px-4 py-6">
            Sole Supply · Addis Ababa, Ethiopia
          </div>
        </footer>
      </body>
    </html>
  );
}
