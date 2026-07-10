import { NextRequest, NextResponse } from "next/server";
import { scrapeOpenGraph } from "@/lib/scrape";
import { brandFromUrl } from "@/lib/brand";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { error: gateError } = await requireRole(["admin", "submitter"]);
  if (gateError) return gateError;

  const { url } = await req.json().catch(() => ({ url: "" }));
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  try {
    const meta = await scrapeOpenGraph(url);
    return NextResponse.json({ ...meta, brand: brandFromUrl(url) });
  } catch (e) {
    return NextResponse.json(
      { title: null, image: null, price: null, brand: brandFromUrl(url) },
      { status: 200 }
    );
  }
}
