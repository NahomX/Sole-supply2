const BRAND_MAP: Array<{ host: RegExp; brand: string }> = [
  { host: /(^|\.)nike\.com$/i, brand: "Nike" },
  { host: /(^|\.)adidas\.com$/i, brand: "Adidas" },
  { host: /(^|\.)footlocker\.com$/i, brand: "Foot Locker" },
  { host: /(^|\.)newbalance\.com$/i, brand: "New Balance" },
  { host: /(^|\.)puma\.com$/i, brand: "Puma" },
  { host: /(^|\.)converse\.com$/i, brand: "Converse" },
  { host: /(^|\.)vans\.com$/i, brand: "Vans" },
  { host: /(^|\.)reebok\.com$/i, brand: "Reebok" },
  { host: /(^|\.)jordan\.com$/i, brand: "Jordan" },
  { host: /(^|\.)finishline\.com$/i, brand: "Finish Line" },
  { host: /(^|\.)champssports\.com$/i, brand: "Champs Sports" },
  { host: /(^|\.)eastbay\.com$/i, brand: "Eastbay" },
  { host: /(^|\.)snipes(usa)?\.com$/i, brand: "Snipes" },
  { host: /(^|\.)hibbett\.com$/i, brand: "Hibbett" },
  { host: /(^|\.)dickssportinggoods\.com$/i, brand: "Dick's" },
];

export function brandFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    for (const { host: rx, brand } of BRAND_MAP) {
      if (rx.test(host)) return brand;
    }
    return null;
  } catch {
    return null;
  }
}
