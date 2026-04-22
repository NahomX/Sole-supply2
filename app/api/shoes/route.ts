import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { brandFromUrl } from "@/lib/brand";
import { scrapeOpenGraph } from "@/lib/scrape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = supabaseServer();
  const { data, error } = await db
    .from("shoes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ shoes: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const url = String(body.url ?? "");
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  const scraped = await scrapeOpenGraph(url).catch(() => ({
    title: null,
    image: null,
    price: null,
  }));
  const brand = brandFromUrl(url);

  const row = {
    url,
    title: (body.title ?? scraped.title ?? url).toString().slice(0, 300),
    brand,
    image_url: body.image_url ?? scraped.image ?? null,
    price_usd: body.price_usd ?? scraped.price ?? null,
    sizes: body.sizes ?? null,
    notes: body.notes ?? null,
    status: "upcoming",
  };

  const db = supabaseServer();
  const { data, error } = await db.from("shoes").insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ shoe: data });
}
