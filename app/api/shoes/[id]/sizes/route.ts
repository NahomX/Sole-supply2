/**
 * app/api/shoes/[id]/sizes/route.ts
 *
 * Per-size logistics status management.
 *
 * GET    /api/shoes/:id/sizes         — list all shoe_sizes rows for this shoe
 * POST   /api/shoes/:id/sizes         — add a size (admin only)
 * DELETE /api/shoes/:id/sizes?us_size — remove a size (admin only)
 * PATCH  /api/shoes/:id/sizes/:usSize — set a size's logistics_status (admin + shipper)
 *
 * PATCH is the primary shipper action: they set one size's status at a time.
 * Admins additionally can add/remove sizes from the SIZE_GRID.
 *
 * Role gating:
 * - GET: any authenticated user with admin or shipper role.
 * - POST / DELETE: admin only (structural change to which sizes a shoe has).
 * - PATCH (status): admin + shipper.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import {
  LOGISTICS,
  getShoeSizes,
  setSizeStatus,
  addSize,
  removeSize,
} from "@/lib/shoes";
import type { LogisticsStatus } from "@/lib/supabase";
import { SIZE_GRID } from "@/lib/sizes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_US_SIZES = new Set(SIZE_GRID.map((e) => e.us));

// GET — list sizes for a shoe (admin + shipper)
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { error: gateError } = await requireRole(["admin", "shipper"]);
  if (gateError) return gateError;

  const { sizes, error } = await getShoeSizes(params.id);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ sizes });
}

// POST — add a size (admin only)
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { session, error: gateError } = await requireRole(["admin"]);
  if (gateError) return gateError;
  void session;

  const body = await req.json().catch(() => ({}));
  const usSize = body.us_size;
  if (typeof usSize !== "string" || !VALID_US_SIZES.has(usSize)) {
    return NextResponse.json(
      { error: `us_size must be a valid SIZE_GRID value (e.g. "9", "10.5")` },
      { status: 400 }
    );
  }

  const { size, error } = await addSize(params.id, usSize);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ size }, { status: 201 });
}

// DELETE — remove a size (admin only); us_size in query param
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { session, error: gateError } = await requireRole(["admin"]);
  if (gateError) return gateError;
  void session;

  const usSize = req.nextUrl.searchParams.get("us_size");
  if (!usSize || !VALID_US_SIZES.has(usSize)) {
    return NextResponse.json(
      { error: `us_size query param required and must be a valid SIZE_GRID value` },
      { status: 400 }
    );
  }

  const { error } = await removeSize(params.id, usSize);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// PATCH — set status on one size (admin + shipper)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { session, error: gateError } = await requireRole(["admin", "shipper"]);
  if (gateError) return gateError;

  const body = await req.json().catch(() => ({}));
  const usSize = body.us_size;
  const newStatus = body.logistics_status;

  if (typeof usSize !== "string" || !VALID_US_SIZES.has(usSize)) {
    return NextResponse.json(
      { error: `us_size required and must be a valid SIZE_GRID value` },
      { status: 400 }
    );
  }

  // null clears the status (set back to "not started").
  if (
    newStatus !== null &&
    !(typeof newStatus === "string" && LOGISTICS.includes(newStatus as LogisticsStatus))
  ) {
    return NextResponse.json(
      { error: "logistics_status must be one of: " + LOGISTICS.join(", ") + " (or null)" },
      { status: 400 }
    );
  }

  const actorLabel = session?.email ?? undefined;
  const meta = { actorLabel, source: "web" };

  const { size, error } = await setSizeStatus(
    params.id,
    usSize,
    newStatus as LogisticsStatus | null,
    meta
  );
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ size });
}
