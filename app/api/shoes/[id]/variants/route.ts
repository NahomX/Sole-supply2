import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase";
import type { ShoeVariant } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/shoes/:id/variants — list variants for a shoe. Admin only. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error: gateError } = await requireRole(["admin"]);
  if (gateError) return gateError;

  const db = supabaseService();
  const { data, error } = await db
    .from("shoe_variants")
    .select("*")
    .eq("shoe_id", params.id)
    .order("sort_order", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ variants: (data as ShoeVariant[]) ?? [] });
}

/** POST /api/shoes/:id/variants — create a new variant. Admin only. */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error: gateError } = await requireRole(["admin"]);
  if (gateError) return gateError;

  const body = await req.json().catch(() => ({}));
  const colorName = typeof body.color_name === "string" ? body.color_name.trim() : "";
  if (!colorName) {
    return NextResponse.json({ error: "color_name is required" }, { status: 400 });
  }

  const row: Record<string, unknown> = {
    shoe_id: params.id,
    color_name: colorName,
  };
  if (typeof body.swatch_hex === "string" && body.swatch_hex.trim()) {
    row.swatch_hex = body.swatch_hex.trim();
  }
  if (typeof body.swatch_image_url === "string" && body.swatch_image_url.trim()) {
    row.swatch_image_url = body.swatch_image_url.trim();
  }
  if (typeof body.sort_order === "number") {
    row.sort_order = body.sort_order;
  }

  const db = supabaseService();
  const { data, error } = await db
    .from("shoe_variants")
    .insert(row)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ variant: data as ShoeVariant }, { status: 201 });
}

/** DELETE /api/shoes/:id/variants?variant_id=X — delete a variant. Admin only. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error: gateError } = await requireRole(["admin"]);
  if (gateError) return gateError;

  const variantId = req.nextUrl.searchParams.get("variant_id");
  if (!variantId) {
    return NextResponse.json({ error: "variant_id query param required" }, { status: 400 });
  }

  const db = supabaseService();
  // Ensure the variant belongs to this shoe before deleting.
  const { error } = await db
    .from("shoe_variants")
    .delete()
    .eq("id", variantId)
    .eq("shoe_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
