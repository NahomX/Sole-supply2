/**
 * browser.ts — Playwright driver with pluggable per-retailer adapter interface.
 *
 * INVARIANTS:
 *   1. PAN/CVC are typed by DETERMINISTIC code (this module) — NEVER by the LLM.
 *   2. The adapter interface decouples retailer-specific selectors from the
 *      core agent loop; real retailer adapters are Phase 4.
 *   3. Browsers run in a self-hosted Playwright process (not Browserbase/Steel)
 *      so card details never leave our controlled environment.
 *   4. This module must NOT be imported by the Next.js app (Vercel plane).
 *
 * Adapter architecture:
 *   Each retailer implements `RetailerAdapter`. The adapter provides only
 *   selector maps and page-navigation logic; it never sees PAN/CVC.
 *   Card entry is handled by `fillCardDetails()` in this module.
 *
 * Phase 3 ships ONE built-in adapter: `SandboxAdapter` targeting a generic
 * HTML form (used for TEST end-to-end validation without a real retailer).
 * Real retailer adapters (Nike, Footlocker, etc.) are deferred to Phase 4.
 */

import {
  Browser,
  BrowserContext,
  chromium,
  Page,
} from "playwright";
import type { CardSecrets } from "./card.js";

// ---------------------------------------------------------------------------
// Adapter interface — one implementation per retailer.
// ---------------------------------------------------------------------------

/** Describes the product state the agent observed at the retailer URL. */
export interface RetailerProductState {
  url: string;
  title: string;
  /** Price in cents (USD). */
  priceCents: number;
  /** Available sizes as reported by the retailer page. */
  availableSizes: string[];
  /** Whether the item is currently purchasable. */
  inStock: boolean;
  /** Which size the agent intends to order. */
  targetSize: string;
  /** Raw page snapshot for audit purposes (truncated). */
  pageSnippet: string;
}

/** Checkout form field selectors (adapter-provided). */
export interface CheckoutSelectors {
  /** CSS selector for size selection element (e.g. a button or dropdown). */
  sizeSelector: (size: string) => string;
  /** Add-to-cart button selector. */
  addToCartSelector: string;
  /** Proceed-to-checkout selector (may be same page or cart page). */
  proceedToCheckoutSelector: string;
  /** Card number input selector. */
  cardNumberSelector: string;
  /** Card expiry input selector. */
  cardExpirySelector: string;
  /** Card CVC input selector. */
  cardCvcSelector: string;
  /** Name on card input (optional; if null, field is skipped). */
  cardNameSelector: string | null;
  /** Final "place order" / "pay now" button selector. */
  placeOrderSelector: string;
  /** Selector for order confirmation element (proves success). */
  orderConfirmationSelector: string;
}

/** Per-retailer adapter interface. */
export interface RetailerAdapter {
  /** Human-readable name for logging. */
  name: string;
  /**
   * URL pattern(s) this adapter handles.
   * Must not match real retailer domains in Phase 3 (sandbox only).
   */
  matches: (url: string) => boolean;
  /** Navigate to the product page and extract current state. */
  getProductState(page: Page, url: string): Promise<RetailerProductState>;
  /** Return selectors for the checkout flow. */
  getCheckoutSelectors(): CheckoutSelectors;
}

// ---------------------------------------------------------------------------
// Sandbox adapter — Phase 3 test-only target.
// ---------------------------------------------------------------------------

/**
 * SandboxAdapter — targets a local or staging sandbox checkout page.
 *
 * This is the ONLY built-in adapter for Phase 3. It is designed for TEST
 * end-to-end validation (Stripe test card, sandbox retailer form).
 *
 * Real retailer adapters (Nike, Footlocker, SNKRS, etc.) are deferred to
 * Phase 4. Hardcoding real retailer selectors here is intentionally omitted.
 */
export class SandboxAdapter implements RetailerAdapter {
  readonly name = "sandbox";

  matches(url: string): boolean {
    // Only handle localhost or explicit sandbox domain URLs.
    return (
      url.startsWith("http://localhost") ||
      url.startsWith("http://127.0.0.1") ||
      url.includes("sandbox-checkout.example")
    );
  }

  async getProductState(
    page: Page,
    url: string
  ): Promise<RetailerProductState> {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Generic selectors for a basic HTML checkout sandbox form.
    const title =
      (await page.locator('[data-testid="product-title"]').textContent()) ??
      "Sandbox Product";
    const priceText =
      (await page
        .locator('[data-testid="product-price"]')
        .textContent()
        .catch(() => "0")) ?? "0";
    const priceCents =
      Math.round(parseFloat(priceText.replace(/[^0-9.]/g, "")) * 100) || 0;

    const sizeButtons = await page
      .locator('[data-testid^="size-btn-"]')
      .all();
    const availableSizes: string[] = [];
    for (const btn of sizeButtons) {
      const disabled = await btn.getAttribute("disabled");
      if (disabled === null) {
        const text = await btn.textContent();
        if (text) availableSizes.push(text.trim());
      }
    }

    const snippet = (await page.content()).slice(0, 500);

    return {
      url,
      title,
      priceCents,
      availableSizes,
      inStock: availableSizes.length > 0,
      targetSize: availableSizes[0] ?? "",
      pageSnippet: snippet,
    };
  }

  getCheckoutSelectors(): CheckoutSelectors {
    return {
      sizeSelector: (size: string) =>
        `[data-testid="size-btn-${size}"]`,
      addToCartSelector: '[data-testid="add-to-cart"]',
      proceedToCheckoutSelector: '[data-testid="proceed-checkout"]',
      cardNumberSelector: '[data-testid="card-number"]',
      cardExpirySelector: '[data-testid="card-expiry"]',
      cardCvcSelector: '[data-testid="card-cvc"]',
      cardNameSelector: '[data-testid="card-name"]',
      placeOrderSelector: '[data-testid="place-order"]',
      orderConfirmationSelector: '[data-testid="order-confirmation"]',
    };
  }
}

// ---------------------------------------------------------------------------
// Browser driver.
// ---------------------------------------------------------------------------

/** Registry of available adapters (Phase 3: only sandbox). */
const ADAPTERS: RetailerAdapter[] = [new SandboxAdapter()];

/** Find the adapter for a URL, or throw if unsupported. */
function resolveAdapter(url: string): RetailerAdapter {
  const adapter = ADAPTERS.find((a) => a.matches(url));
  if (!adapter) {
    throw new Error(
      `browser.ts: No adapter registered for URL "${url}". ` +
        "Real retailer adapters are deferred to Phase 4."
    );
  }
  return adapter;
}

/** Shared browser instance (lazy singleton per process). */
let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }
  return _browser;
}

/** Close the browser (call on process shutdown). */
export async function closeBrowser(): Promise<void> {
  if (_browser && _browser.isConnected()) {
    await _browser.close();
    _browser = null;
  }
}

/**
 * Retrieve the current product state at `url` (size availability, price, stock).
 * The LLM calls this tool to decide whether to proceed.
 */
export async function getRetailerProductState(
  url: string
): Promise<RetailerProductState> {
  const adapter = resolveAdapter(url);
  const browser = await getBrowser();
  const ctx: BrowserContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  try {
    return await adapter.getProductState(page, url);
  } finally {
    await ctx.close();
  }
}

/** Result of a checkout attempt. */
export interface CheckoutResult {
  success: boolean;
  /** Order confirmation number / ID from the retailer, if available. */
  confirmationId: string | null;
  /** Error message on failure. */
  error: string | null;
}

/**
 * Execute checkout for a single size + card.
 *
 * DETERMINISTIC card entry: PAN/CVC are typed by this function, not the LLM.
 * The caller must zero `cardSecrets` immediately after this function returns
 * (in a finally block) regardless of success/failure.
 *
 * @param url          - Product page URL.
 * @param targetSize   - Size to purchase (must be in product's available sizes).
 * @param cardSecrets  - Ephemeral card secrets (zeroed after use by caller).
 * @param dryRun       - If true, navigate and fill form but DO NOT click "place order".
 *                       Always true in Phase 3 TEST mode unless caller explicitly sets false.
 */
export async function submitCheckout(
  url: string,
  targetSize: string,
  cardSecrets: CardSecrets,
  dryRun = true
): Promise<CheckoutResult> {
  // Phase 3 test-mode guard: never execute a real order without explicit opt-in.
  if (cardSecrets.livemode) {
    throw new Error(
      "browser.ts: submitCheckout received a live-mode card. " +
        "Live mode is not enabled in Phase 3. See Phase 4 plan."
    );
  }

  const adapter = resolveAdapter(url);
  const sel = adapter.getCheckoutSelectors();
  const browser = await getBrowser();

  const ctx: BrowserContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();

  try {
    // --- Step 1: Navigate to product page ---
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // --- Step 2: Select size ---
    await page.locator(sel.sizeSelector(targetSize)).click({ timeout: 10_000 });

    // --- Step 3: Add to cart ---
    await page.locator(sel.addToCartSelector).click({ timeout: 10_000 });

    // --- Step 4: Proceed to checkout ---
    await page.locator(sel.proceedToCheckoutSelector).click({ timeout: 15_000 });

    // --- Step 5: Fill card details (DETERMINISTIC — not the LLM) ---
    // Card number
    await page
      .locator(sel.cardNumberSelector)
      .fill(cardSecrets.pan, { timeout: 10_000 });

    // Expiry (MM/YY format)
    const expiryFormatted = `${String(cardSecrets.expMonth).padStart(2, "0")}/${String(cardSecrets.expYear).slice(-2)}`;
    await page
      .locator(sel.cardExpirySelector)
      .fill(expiryFormatted, { timeout: 10_000 });

    // CVC
    await page
      .locator(sel.cardCvcSelector)
      .fill(cardSecrets.cvc, { timeout: 10_000 });

    // Name on card (optional)
    if (sel.cardNameSelector) {
      await page
        .locator(sel.cardNameSelector)
        .fill("Berebaso Agent", { timeout: 10_000 });
    }

    if (dryRun) {
      // TEST-mode dry run: stop here — don't actually submit the order.
      console.log(
        `[browser] DRY RUN — form filled for ${url} size ${targetSize}. ` +
          "Not submitting (dryRun=true). Set dryRun=false to execute real order."
      );
      return { success: true, confirmationId: "DRY_RUN", error: null };
    }

    // --- Step 6: Place order (live path — Phase 4+) ---
    await page.locator(sel.placeOrderSelector).click({ timeout: 15_000 });

    // --- Step 7: Wait for confirmation ---
    await page.waitForSelector(sel.orderConfirmationSelector, {
      timeout: 30_000,
    });
    const confirmationEl = page.locator(sel.orderConfirmationSelector);
    const confirmationId = (await confirmationEl.textContent()) ?? null;

    return { success: true, confirmationId, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, confirmationId: null, error: message };
  } finally {
    await ctx.close();
  }
}
