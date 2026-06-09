/**
 * lib/site-copy.ts — server-side data access for Telegram-editable storefront copy.
 *
 * The storefront (app/page.tsx, app/layout.tsx) reads its hero tagline, section
 * titles, and footer from the site_copy table so they can be edited from the
 * Telegram site-edit bot. To guarantee the site renders identically when the
 * table is missing/empty (or a key was never seeded), every read falls back to
 * DEFAULTS — the EXACT strings that were previously hardcoded.
 *
 * IMPORTANT: this module must stay server-only (it uses supabaseService which
 * holds the service-role key). Never import it from a "use client" component.
 *
 * Mirrors the style of lib/shoes.ts: same supabaseService() helper, never throws.
 */

import { supabaseService } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Keys + DEFAULTS — the canonical set of editable strings and their fallbacks.
// DEFAULTS hold the strings previously hardcoded in app/page.tsx + app/layout.tsx
// so the storefront is byte-identical until an edit is made.
// ---------------------------------------------------------------------------

export type SiteCopyKey =
  | "hero_tagline"
  | "section_available"
  | "section_on_the_way"
  | "section_coming_soon"
  | "section_previously"
  | "footer";

/** Per-key bilingual fallback. `am` is omitted where no Amharic string exists. */
export const DEFAULTS: Record<SiteCopyKey, { en?: string; am?: string }> = {
  hero_tagline: {
    en: "Fresh sneakers from the US, straight to Addis.",
    am: "ከአሜሪካ የመጡ አዳዲስ ጫማዎች፣ በቀጥታ ወደ አዲስ አበባ",
  },
  section_available: { en: "Available now", am: "አሁን ዝግጁ" },
  section_on_the_way: { en: "On the way", am: "በመንገድ ላይ" },
  section_coming_soon: { en: "Coming soon", am: "በቅርቡ ይመጣል" },
  section_previously: { en: "Previously", am: "ቀደም ሲል የነበሩ" },
  footer: { en: "Addis Ababa, Ethiopia" },
};

export type SiteCopyLang = "en" | "am";

/**
 * Fetch ALL site_copy rows, merged over DEFAULTS so every known key is present.
 * On ANY error (missing table, network, empty config) returns DEFAULTS.
 * Must never throw — the storefront renders the hardcoded copy as a fallback.
 */
export async function getSiteCopy(): Promise<
  Record<string, { en?: string; am?: string }>
> {
  // Start from a shallow copy of DEFAULTS so missing keys/langs fall back.
  const out: Record<string, { en?: string; am?: string }> = {};
  for (const [k, v] of Object.entries(DEFAULTS)) {
    out[k] = { ...v };
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return out;

  try {
    const db = supabaseService();
    const { data, error } = await db
      .from("site_copy")
      .select("key,value_en,value_am");
    if (error || !data) return out;

    for (const row of data as {
      key: string;
      value_en: string | null;
      value_am: string | null;
    }[]) {
      const prev = out[row.key] ?? {};
      out[row.key] = {
        // Only override the fallback when the DB holds a non-null value.
        en: row.value_en ?? prev.en,
        am: row.value_am ?? prev.am,
      };
    }
    return out;
  } catch {
    // Never propagate — fall back to DEFAULTS so the site still renders.
    return out;
  }
}

/**
 * Convenience: resolve one key in one language from a fetched copy map,
 * falling back to DEFAULTS (and then the English default) if absent.
 *
 * Pass the map returned by getSiteCopy() so a page only fetches once.
 */
export function getCopy(
  copy: Record<string, { en?: string; am?: string }>,
  key: SiteCopyKey,
  lang: SiteCopyLang
): string {
  const entry = copy[key] ?? DEFAULTS[key] ?? {};
  const fallback = DEFAULTS[key] ?? {};
  return (
    entry[lang] ??
    fallback[lang] ??
    entry.en ??
    fallback.en ??
    ""
  );
}

/**
 * Upsert one row's value for the given language + audit fields.
 * Writes value_en OR value_am (per `lang`), updated_by, and updated_at=now().
 * Returns { error } — never throws.
 */
export async function setCopy(
  key: SiteCopyKey,
  lang: SiteCopyLang,
  value: string,
  updatedBy: string
): Promise<{ error: string | null }> {
  try {
    const db = supabaseService();
    const row: {
      key: string;
      value_en?: string;
      value_am?: string;
      updated_by: string;
      updated_at: string;
    } = {
      key,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    };
    if (lang === "en") row.value_en = value;
    else row.value_am = value;

    const { error } = await db
      .from("site_copy")
      .upsert(row, { onConflict: "key" });
    if (error) return { error: error.message };
    return { error: null };
  } catch (err) {
    return { error: (err as Error).message ?? "setCopy failed" };
  }
}
