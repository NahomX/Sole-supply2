/**
 * lib/bots/auth.ts — Telegram bot allowlist checks.
 *
 * Non-customer bots call `checkAllowlist` before any privileged action.
 * The customer bot skips this entirely — it is public.
 */

import { supabaseService } from "@/lib/supabase";
import type { BotRole } from "./registry";

export type TelegramUser = {
  telegram_id: number;
  role: "admin" | "shipper" | "purchaser";
  label: string | null;
  allowed_bots: string[] | null;
  created_at: string;
};

export type AllowlistResult =
  | { allowed: true; user: TelegramUser }
  | { allowed: false; reason: string };

/**
 * Check whether a Telegram user (by numeric ID) is allowed to use a given bot.
 *
 * Rules:
 * - The row must exist in `telegram_users`.
 * - The row's role must satisfy the required role for the bot:
 *   - "admin" satisfies any requirement.
 *   - "purchaser" satisfies only a "purchaser" requirement.
 *   - "shipper" satisfies only a "shipper" requirement.
 *   - "public" bots never reach this check.
 * - If `allowed_bots` is set, the bot name must appear in that array.
 */
export async function checkAllowlist(
  telegramId: number,
  botName: string,
  requiredRole: BotRole
): Promise<AllowlistResult> {
  if (requiredRole === "public") {
    // Public bots never check the allowlist.
    throw new Error("checkAllowlist called on a public bot — skip this call");
  }

  const db = supabaseService();
  const { data, error } = await db
    .from("telegram_users")
    .select("*")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (error) {
    console.error("[bot-auth] DB error:", error.message);
    return { allowed: false, reason: "internal error" };
  }

  if (!data) {
    return {
      allowed: false,
      reason: "You are not on the allowlist for this bot.",
    };
  }

  const user = data as TelegramUser;

  // Role hierarchy:
  //   admin satisfies any requirement.
  //   purchaser satisfies only "purchaser".
  //   shipper satisfies only "shipper".
  const roleOk =
    user.role === "admin" ||
    (requiredRole === "purchaser" && user.role === "purchaser") ||
    (requiredRole === "shipper" && user.role === "shipper");

  if (!roleOk) {
    return {
      allowed: false,
      reason: "Your role does not permit access to this bot.",
    };
  }

  // Per-bot scoping: if allowed_bots is set, the bot name must appear in it.
  if (user.allowed_bots !== null && !user.allowed_bots.includes(botName)) {
    return {
      allowed: false,
      reason: "You are not allowed to use this specific bot.",
    };
  }

  return { allowed: true, user };
}
