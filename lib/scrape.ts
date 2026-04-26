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

function parsePrice(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

export async function scrapeOpenGraph(url: string): Promise<Scraped> {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; SoleSupplyBot/1.0; +https://solesupply.example)",
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!res.ok) return { title: null, image: null, price: null };
  const html = await res.text();

  const rawTitle =
    pickMeta(html, ["og:title", "twitter:title"]) ??
    (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null);
  const image = pickMeta(html, ["og:image", "og:image:secure_url", "twitter:image"]);
  const priceRaw =
    pickMeta(html, [
      "product:price:amount",
      "og:price:amount",
      "twitter:data1",
    ]);
  return {
    title: rawTitle ? decodeEntities(rawTitle) : null,
    image,
    price: parsePrice(priceRaw),
  };
}
