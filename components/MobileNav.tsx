"use client";

import { useState } from "react";
import Link from "next/link";

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden ml-auto mr-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-cream/70 hover:text-cream p-1"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
      >
        {open ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        )}
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full bg-[#0c0c0c]/98 backdrop-blur-md border-b border-white/10 px-4 py-4 flex flex-col gap-3 text-[14px] font-semibold z-50">
          <Link href="/#in-stock" onClick={() => setOpen(false)} className="text-cream/70 hover:text-cream">In stock</Link>
          <Link href="/#on-the-way" onClick={() => setOpen(false)} className="text-cream/70 hover:text-cream">On the way</Link>
          <Link href="/#coming-soon" onClick={() => setOpen(false)} className="text-cream/70 hover:text-cream">Coming soon</Link>
          <Link href="/#how" onClick={() => setOpen(false)} className="text-cream/70 hover:text-cream">How it works</Link>
          <Link href="/#visit" onClick={() => setOpen(false)} className="text-cream/70 hover:text-cream">Visit us</Link>
        </div>
      )}
    </div>
  );
}
