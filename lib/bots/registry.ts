/**
 * lib/bots/registry.ts — Bot registry.
 *
 * Every bot is described by one entry here. The dynamic webhook route
 * `app/api/telegram/[bot]/route.ts` looks up the entry by the [bot] path
 * segment, verifies the secret-token header, and dispatches to the handler.
 *
 * Adding a new bot = one entry here + one env token + registering its webhook.
 * No new route code needed.
 */

export type BotRole = "public" | "shipper" | "admin";

export type BotEntry = {
  /** URL-safe name used as the [bot] path segment. */
  name: string;
  /** Human-readable description. */
  description: string;
  /**
   * Which role is required to use this bot.
   * "public" = no allowlist check (customer bot only).
   */
  role: BotRole;
  /**
   * Environment variable that holds the bot token.
   * The actual value is read at runtime via process.env[tokenEnvVar].
   */
  tokenEnvVar: string;
};

export const BOT_REGISTRY: BotEntry[] = [
  {
    name: "customer",
    description: "Public browse bot — lists available and upcoming shoes.",
    role: "public",
    tokenEnvVar: "CUSTOMER_BOT_TOKEN",
  },
  {
    name: "incart",
    description: "In-cart bot — paste a URL to add a shoe to the in_cart queue.",
    role: "shipper",
    tokenEnvVar: "INCART_BOT_TOKEN",
  },
  {
    name: "purchaser",
    description: "Purchaser bot — tap a shoe to mark it purchased.",
    role: "shipper",
    tokenEnvVar: "PURCHASER_BOT_TOKEN",
  },
  {
    name: "arrived",
    description: "Arrived bot — tap a purchased shoe to mark it arrived.",
    role: "shipper",
    tokenEnvVar: "ARRIVED_BOT_TOKEN",
  },
  {
    name: "delivery",
    description: "Delivery bot — tap an arrived shoe to mark it delivered.",
    role: "shipper",
    tokenEnvVar: "DELIVERY_BOT_TOKEN",
  },
  {
    name: "ops",
    description: "Owner ops bot — full pipeline control + status corrections.",
    role: "admin",
    tokenEnvVar: "OPS_BOT_TOKEN",
  },
];

/** Look up a registry entry by bot name. Returns undefined if not found. */
export function getBotEntry(name: string): BotEntry | undefined {
  return BOT_REGISTRY.find((b) => b.name === name);
}
