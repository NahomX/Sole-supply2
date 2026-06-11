/**
 * lib/storage.ts — Supabase Storage helpers (server-only, service-role).
 *
 * The 'shoe-videos' bucket (created in migration 0012) is PUBLIC-READ only:
 * the migration grants SELECT on its objects and nothing else, so all writes
 * MUST go through supabaseService() (service role bypasses storage RLS).
 * Never import this module from client-side code.
 */

import { supabaseService } from "@/lib/supabase";

/** Public-read bucket holding per-shoe hands-on videos (migration 0012). */
const SHOE_VIDEOS_BUCKET = "shoe-videos";

export type UploadResult =
  | { url: string; error: null }
  | { url: null; error: string };

/**
 * Upload (or replace) the hands-on video for a shoe.
 *
 * Stores the object at `<shoeId>.mp4` with upsert, so re-uploading for the
 * same shoe overwrites in place. Returns the bucket's public URL with a
 * `?v=<timestamp>` cache-buster appended — the path is stable across
 * re-uploads and the storage CDN caches public objects, so the query param
 * ensures clients fetch the new video after a replacement.
 */
export async function uploadShoeVideo(
  shoeId: string,
  data: Buffer | ArrayBuffer,
  contentType = "video/mp4"
): Promise<UploadResult> {
  const db = supabaseService();
  const path = `${shoeId}.mp4`;

  const { error } = await db.storage
    .from(SHOE_VIDEOS_BUCKET)
    .upload(path, data, { contentType, upsert: true });
  if (error) return { url: null, error: error.message };

  const { data: pub } = db.storage.from(SHOE_VIDEOS_BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) {
    return { url: null, error: "could not resolve public URL" };
  }
  return { url: `${pub.publicUrl}?v=${Date.now()}`, error: null };
}
