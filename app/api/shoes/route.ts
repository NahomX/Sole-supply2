import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createShoeFromUrl } from "@/lib/shoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// No GET handler. Listing shoes is done server-side in app/page.tsx (with
// shoe.url redacted for non-admins) and in app/admin/page.tsx (admin only).
// A public JSON endpoint would re-leak the procurement URL — only add one
// back if you can guarantee the field whitelist.

export async function POST(req: NextRequest) {
  const { session, error: gateError } = await requireRole(["admin", "submitter"]);
  if (gateError) return gateError;

  const body = await req.json().catch(() => ({}));
  const url = String(body.url ?? "");

  const result = await createShoeFromUrl({
    url,
    title: body.title ?? null,
    image_url: body.image_url ?? null,
    price_usd: body.price_usd ?? null,
    sizes: body.sizes ?? null,
    notes: body.notes ?? null,
    quantity: typeof body.quantity === "number" ? body.quantity : null,
    meta: {
      actorLabel: session?.email ?? undefined,
      source: "web",
    },
  });

  if (result.error) {
    const status = result.error === "invalid url" ? 400 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ shoe: result.shoe });
}
