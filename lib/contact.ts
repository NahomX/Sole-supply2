// lib/contact.ts
// Contact info for the storefront — env-var-driven so the owner can set
// real values in Vercel without a code change. Fallbacks are intentionally
// generic ("Coming soon" style) rather than obviously-placeholder.

export const contact = {
  /** Physical store address (line 1). */
  addressEn: process.env.NEXT_PUBLIC_STORE_ADDRESS_EN || "Addis Ababa, Ethiopia",
  /** Amharic address. */
  addressAm: process.env.NEXT_PUBLIC_STORE_ADDRESS_AM || "አዲስ አበባ፣ ኢትዮጵያ",
  /** Google Maps query string. */
  mapsQuery: process.env.NEXT_PUBLIC_STORE_MAPS_QUERY || "Addis+Ababa,+Ethiopia",
  /** Phone number (display text). */
  phone: process.env.NEXT_PUBLIC_STORE_PHONE || "",
  /** Phone number for tel: link (digits only, with country code). */
  phoneTel: process.env.NEXT_PUBLIC_STORE_PHONE_TEL || "",
  /** Store hours. */
  hours: process.env.NEXT_PUBLIC_STORE_HOURS || "Mon–Sat, 9:00–19:00",
  /** Telegram handle (without @). */
  telegram: process.env.NEXT_PUBLIC_STORE_TELEGRAM || "",
  /** Full Telegram deep link. */
  telegramUrl: process.env.NEXT_PUBLIC_STORE_TELEGRAM
    ? `https://t.me/${process.env.NEXT_PUBLIC_STORE_TELEGRAM}`
    : "",
} as const;
