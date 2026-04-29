export type Scraped = {
  title: string | null;
  image: string | null;
  price: number | null;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function pickMeta(html: string, names: string[]): string | null {
  for (const name of names) {
    const rx = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`,
      "i"
    );
    const m = html.match(rx);
    if (m) return m[1];
    const rx2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`,
      "i"
    );
    const m2 = html.match(rx2);
    if (m2) return m2[1];
  }
  return null;
}

function parsePrice(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const m = raw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

// Walk a JSON-LD value tree and pull the first Product node we can find.
// Pages sometimes nest Products inside @graph arrays, ItemList, BreadcrumbList,
// etc. so we recurse through arrays and objects rather than expecting a flat shape.
type LdProduct = {
  name?: unknown;
  image?: unknown;
  offers?: unknown;
  brand?: unknown;
};
function findProduct(node: unknown): LdProduct | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProduct(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    const isProduct =
      t === "Product" || (Array.isArray(t) && t.includes("Product"));
    if (isProduct) return obj as LdProduct;
    if (obj["@graph"]) {
      const found = findProduct(obj["@graph"]);
      if (found) return found;
    }
    for (const v of Object.values(obj)) {
      if (typeof v === "object") {
        const found = findProduct(v);
        if (found) return found;
      }
    }
  }
  return null;
}

function pickJsonLd(html: string): Partial<Scraped> {
  const rx = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const product = findProduct(parsed);
    if (!product) continue;

    // image can be a string, an array, or an ImageObject {url}.
    let image: string | null = null;
    const imgRaw = product.image;
    if (typeof imgRaw === "string") image = imgRaw;
    else if (Array.isArray(imgRaw) && imgRaw.length > 0) {
      const first = imgRaw[0];
      image =
        typeof first === "string"
          ? first
          : (first as { url?: string })?.url ?? null;
    } else if (imgRaw && typeof imgRaw === "object") {
      image = (imgRaw as { url?: string }).url ?? null;
    }

    // offers can be a single Offer, an array of Offers, or an AggregateOffer
    // with lowPrice/price. Take the first numeric price we find.
    let price: number | null = null;
    const offersRaw = product.offers;
    const offerList = Array.isArray(offersRaw)
      ? offersRaw
      : offersRaw
      ? [offersRaw]
      : [];
    for (const o of offerList) {
      if (!o || typeof o !== "object") continue;
      const offer = o as { price?: unknown; lowPrice?: unknown };
      const p = parsePrice(offer.price as string | number) ??
        parsePrice(offer.lowPrice as string | number);
      if (p != null) {
        price = p;
        break;
      }
    }

    const name = typeof product.name === "string" ? product.name : null;
    return { title: name, image, price };
  }
  return {};
}

export async function scrapeOpenGraph(url: string): Promise<Scraped> {
  // Use a real-browser UA. Some retailers (Foot Locker, etc.) gate datacenter
  // requests by UA — a custom bot string trips Cloudflare/anti-bot rules even
  // when rate limits would otherwise allow the request.
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) return { title: null, image: null, price: null };
  const html = await res.text();

  // First pass: OpenGraph / Twitter meta tags. Cheapest, most common.
  const ogTitle =
    pickMeta(html, ["og:title", "twitter:title"]) ??
    (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null);
  const ogImage = pickMeta(html, [
    "og:image",
    "og:image:secure_url",
    "twitter:image",
  ]);
  const ogPrice = pickMeta(html, [
    "product:price:amount",
    "og:price:amount",
    "twitter:data1",
  ]);

  // Second pass: JSON-LD Product schema. Many e-commerce sites (Foot Locker,
  // Adidas Canada, Shopify storefronts) ship a schema.org/Product block but
  // no OG image. We only need it as a fallback for missing fields.
  const ld = pickJsonLd(html);

  const title = ogTitle ?? ld.title ?? null;
  const image = ogImage ?? ld.image ?? null;
  const price = parsePrice(ogPrice) ?? ld.price ?? null;

  return {
    title: title ? decodeEntities(title) : null,
    image,
    price,
  };
}
