/**
 * lib/shoe-matcher.ts — AI vision matching of a photo against shoe catalog candidates.
 *
 * `matchPhotoToShoes` downloads each candidate's image_url, passes everything
 * to Gemini 2.5 Flash as inline base64 images, and asks the model to identify
 * which catalog shoe(s) the uploaded photo shows.
 *
 * Constraints:
 *  - Candidates with no image_url are silently skipped.
 *  - At most MAX_CANDIDATES shoes are sent to the model (token budget).
 *  - The Gemini API call times out after 30 seconds.
 *  - Never throws — all errors are returned as { matches: [], error: string }.
 */

import { GoogleGenAI, type Part } from "@google/genai";
import type { Shoe } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ShoeMatch = {
  shoeId: string;
  title: string;
  confidence: "high" | "medium" | "low";
};

export type MatchResult =
  | { matches: ShoeMatch[]; error: null }
  | { matches: []; error: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL = "gemini-2.5-flash";
const MAX_CANDIDATES = 8;
const TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Fetch a URL and return it as a base64-encoded string and mime type. */
async function fetchAsBase64(
  url: string
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(tid);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    // Normalise to a supported image MIME type.
    const mimeType = contentType.startsWith("image/png")
      ? "image/png"
      : contentType.startsWith("image/gif")
      ? "image/gif"
      : contentType.startsWith("image/webp")
      ? "image/webp"
      : "image/jpeg";
    const buf = await res.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    return { base64, mimeType };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Match an uploaded photo against a list of candidate shoes using Gemini vision.
 *
 * @param photoBase64  Base64-encoded photo from the user.
 * @param photoMimeType  MIME type of the user's photo (e.g. "image/jpeg").
 * @param candidates  List of candidate shoes from the DB (title, brand, image_url).
 * @returns A `MatchResult` — either a ranked list of matches or an error string.
 */
export async function matchPhotoToShoes(
  photoBase64: string,
  photoMimeType: string,
  candidates: Array<Pick<Shoe, "id" | "title" | "brand" | "image_url">>
): Promise<MatchResult> {
  if (!process.env.GEMINI_API_KEY) {
    return {
      matches: [],
      error:
        "GEMINI_API_KEY is not configured. Set it in your Vercel environment variables.",
    };
  }

  // Filter to candidates that have an image URL, then cap at MAX_CANDIDATES.
  const withImages = candidates
    .filter((c) => c.image_url != null)
    .slice(0, MAX_CANDIDATES);

  if (withImages.length === 0) {
    return {
      matches: [],
      error: "None of the candidate shoes have catalog images to compare against.",
    };
  }

  // Fetch all candidate images in parallel.
  const fetchedImages = await Promise.all(
    withImages.map(async (c) => {
      const img = await fetchAsBase64(c.image_url!);
      return { candidate: c, img };
    })
  );

  // Build the interleaved content array: text label followed by image for each item.
  const catalogLines: string[] = [];
  const successfulCandidates: Array<Pick<Shoe, "id" | "title" | "brand">> = [];

  // Catalog images (collected after filtering out failed downloads).
  type CatalogEntry = {
    label: string;
    mimeType: string;
    base64: string;
  };
  const catalogEntries: CatalogEntry[] = [];

  for (const { candidate, img } of fetchedImages) {
    if (!img) continue; // Skip if image download failed.
    successfulCandidates.push(candidate);
    const idx = successfulCandidates.length; // 1-based
    const label =
      `[${idx}] ${candidate.title}` + (candidate.brand ? ` (${candidate.brand})` : "");
    catalogLines.push(`${idx}. id=${candidate.id} — ${label}`);
    catalogEntries.push({ label, mimeType: img.mimeType, base64: img.base64 });
  }

  if (successfulCandidates.length === 0) {
    return {
      matches: [],
      error: "Could not download any catalog shoe images to compare against.",
    };
  }

  // Build the parts array: user photo, then each catalog image with its label.
  const parts: Part[] = [
    {
      text: "PHOTO SENT BY USER (the shoe(s) they physically received):",
    },
    {
      inlineData: {
        mimeType: photoMimeType,
        data: photoBase64,
      },
    },
  ];

  for (const entry of catalogEntries) {
    parts.push({ text: `CATALOG IMAGE ${entry.label}:` });
    parts.push({
      inlineData: {
        mimeType: entry.mimeType,
        data: entry.base64,
      },
    });
  }

  const catalogList = catalogLines.join("\n");
  const taskPrompt = `You are comparing the user's photo against ${successfulCandidates.length} catalog shoe image(s). Your task: identify which catalog shoe(s) the user's photo shows.

Catalog shoes (by number):
${catalogList}

Instructions:
- Compare the shoe in the user's photo to each catalog image carefully (silhouette, colorway, branding, sole shape, materials).
- Return a JSON array of matches, ordered from best match to worst.
- Only include shoes that are a plausible match. If nothing matches, return an empty array.
- Each item must have: shoeId (string, exact id from catalog), title (string), confidence ("high"|"medium"|"low").
- confidence=high means the shoe is clearly the same model/colorway. medium means similar but not certain. low means a loose resemblance only.
- Respond with ONLY a raw JSON array, no markdown fences, no explanation. Example: [{"shoeId":"abc-123","title":"Nike Dunk Low","confidence":"high"}]`;

  parts.push({ text: taskPrompt });

  // Call the Gemini API with a timeout via AbortSignal.
  try {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts }],
      config: {
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
        abortSignal: controller.signal,
      },
    });

    clearTimeout(tid);

    const rawText = response.text ?? "";

    // Parse the JSON response defensively.
    let parsed: unknown;
    try {
      // Strip any accidental markdown fences (unlikely with responseMimeType=json, but defensive).
      const cleaned = rawText
        .trim()
        .replace(/^```[a-z]*\n?/i, "")
        .replace(/\n?```$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return {
        matches: [],
        error: `Gemini returned an unparseable response: ${rawText.slice(0, 200)}`,
      };
    }

    if (!Array.isArray(parsed)) {
      return {
        matches: [],
        error: "Gemini returned an unexpected response format.",
      };
    }

    // Validate and normalise each match.
    const validCandidateIds = new Set(successfulCandidates.map((c) => c.id));
    const matches: ShoeMatch[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const obj = item as Record<string, unknown>;
      const shoeId = typeof obj.shoeId === "string" ? obj.shoeId : null;
      const title = typeof obj.title === "string" ? obj.title : null;
      const rawConf = obj.confidence;
      const confidence: ShoeMatch["confidence"] =
        rawConf === "high" || rawConf === "medium" || rawConf === "low"
          ? rawConf
          : "low";

      // Only include IDs that were actually in the candidates we sent.
      if (!shoeId || !title || !validCandidateIds.has(shoeId)) continue;
      matches.push({ shoeId, title, confidence });
    }

    return { matches, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return { matches: [], error: `AI matching failed: ${msg}` };
  }
}
