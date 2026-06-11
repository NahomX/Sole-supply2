/**
 * components/shoe-category.ts — derive a GENERAL category from a shoe title.
 *
 * Approved redesign rule: storefront card titles are general categories
 * ("Air Force 1", not "AIR FORCE 1 '07 LV8 NN") — the full model name only
 * appears on the /shoe/[id] details page.
 *
 * Pure, dependency-free (imported by both the server homepage and the client
 * ShoeCard). Keyword checks run most-specific first: "KOBE AIR FORCE 1 LOW"
 * must resolve to "Kobe AF1" before the "Air Force 1" rule can claim it, and
 * "NIKE SB DUNK LOW" to "Nike SB" before the "Dunk" rule.
 */

const CATEGORY_RULES: { pattern: RegExp; category: string }[] = [
  { pattern: /KOBE/, category: "Kobe AF1" },
  { pattern: /NIKE\s*SB|\bSB\b/, category: "Nike SB" },
  { pattern: /(AIR\s*)?JORDAN\s*1\b/, category: "Air Jordan 1" },
  { pattern: /AIR\s*FORCE\s*1|\bAF\s*-?1\b/, category: "Air Force 1" },
  { pattern: /AIR\s*MAX/, category: "Air Max" },
  { pattern: /DUNK/, category: "Dunk" },
];

/**
 * Trim/variant tokens that don't belong in a general category name —
 * stripped before the first-words fallback ("TENNIS CLASSIC CS STYLE" →
 * "Tennis Classic").
 */
const NOISE_TOKENS = new Set([
  "LOW",
  "MID",
  "HIGH",
  "RETRO",
  "OG",
  "SE",
  "QS",
  "WB",
  "NN",
  "LV8",
  "PRM",
  "PREMIUM",
  "STYLE",
  "CS",
  "FLYKNIT",
  "NEXT",
  "NATURE",
  "'07",
  "07",
  "'82",
  "82",
  "2.0",
  "EDITION",
]);

/** "TENNIS" → "Tennis"; leaves mixed-case words ("iD") alone. */
function titleCaseWord(word: string): string {
  if (word.length > 1 && word === word.toUpperCase()) {
    return word[0] + word.slice(1).toLowerCase();
  }
  return word;
}

export function categoryFromTitle(title: string): string {
  const upper = title.toUpperCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(upper)) return rule.category;
  }
  // Fallback: first 2–3 meaningful words of the title, noise tokens removed.
  const words = title
    .split(/\s+/)
    .filter((w) => w && !NOISE_TOKENS.has(w.toUpperCase()));
  const picked = words.slice(0, 3);
  if (picked.length === 0) return title.trim() || "Sneaker";
  return picked.map(titleCaseWord).join(" ");
}
