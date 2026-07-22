import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase";
import type { ShoeImage, ShoeImageViewType } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIEW_TYPES: ShoeImageViewType[] = [
  "hero",
  "zoom",
  "side",
  "top",
  "back",
  "sole",
  "lifestyle",
];

/** GET /api/shoes/:id/images — list images for a shoe. Admin only. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error: gateError } = await requireRole(["admin"]);
  if (gateError) return gateError;

  const db = supabaseService();
  const { data, error } = await db
    .from("shoe_images")
    .select("*")
    .eq("shoe_id", params.id)
    .order("sort_order", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ images: (data as ShoeImage[]) ?? [] });
}

/** POST /api/shoes/:id/images — add an image to a shoe. Admin only. */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error: gateError } = await requireRole(["admin"]);
  if (gateError) return gateError;

  const body = await req.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "valid image url is required" }, { status: 400 });
  }

  const viewType = typeof body.view_type === "string" ? body.view_type.trim() : "hero";
  if (!VIEW_TYPES.includes(viewType as ShoeImageViewType)) {
    return NextResponse.json(
      { error: `view_type must be one of: ${VIEW_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  const row: Record<string, unknown> = {
    shoe_id: params.id,
    url,
    view_type: viewType,
  };
  if (typeof body.variant_id === "string" && body.variant_id.trim()) {
    row.variant_id = body.variant_id.trim();
  }
  if (typeof body.sort_order === "number") {
    row.sort_order = body.sort_order;
  }

  const db = supabaseService();
  const { data, error } = await db
    .from("shoe_images")
    .insert(row)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ image: data as ShoeImage }, { status: 201 });
}

/** DELETE /api/shoes/:id/images?image_id=X — delete an image. Admin only. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error: gateError } = await requireRole(["admin"]);
  if (gateError) return gateError;

  const imageId = req.nextUrl.searchParams.get("image_id");
  if (!imageId) {
    return NextResponse.json({ error: "image_id query param required" }, { status: 400 });
  }

  const db = supabaseService();
  const { error } = await db
    .from("shoe_images")
    .delete()
    .eq("id", imageId)
    .eq("shoe_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
