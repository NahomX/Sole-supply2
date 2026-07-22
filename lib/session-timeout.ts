/**
 * lib/session-timeout.ts — server-side session timeout helpers.
 *
 * Enforces two timeout windows on authenticated admin/shipper sessions:
 *   1. **Idle timeout** — if the user hasn't made a request within N minutes,
 *      the session is expired (configurable via SESSION_IDLE_TIMEOUT_MINUTES).
 *   2. **Absolute lifetime** — the session expires N hours after login
 *      regardless of activity (configurable via SESSION_ABSOLUTE_TIMEOUT_HOURS).
 *
 * Implementation uses two HttpOnly/Secure/SameSite cookies (no DB schema
 * change required). The middleware stamps + checks them on every request;
 * auth/callback sets the login timestamp; auth/sign-out clears them.
 *
 * The `checkSessionTimeout` function is pure (no I/O, takes timestamps as
 * arguments) so it can be unit-tested trivially once a test framework is added.
 */

// ---------------------------------------------------------------------------
// Cookie names
// ---------------------------------------------------------------------------

export const LOGIN_AT_COOKIE = "ss_login_at";
export const LAST_ACTIVITY_COOKIE = "ss_last_activity";

// ---------------------------------------------------------------------------
// Timeout configuration — env-driven with sane defaults
// ---------------------------------------------------------------------------

const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;
const DEFAULT_ABSOLUTE_TIMEOUT_HOURS = 8;

export function getIdleTimeoutMs(): number {
  const raw = process.env.SESSION_IDLE_TIMEOUT_MINUTES;
  const minutes = raw ? parseInt(raw, 10) : NaN;
  return (
    (Number.isFinite(minutes) && minutes > 0
      ? minutes
      : DEFAULT_IDLE_TIMEOUT_MINUTES) *
    60 *
    1000
  );
}

export function getAbsoluteTimeoutMs(): number {
  const raw = process.env.SESSION_ABSOLUTE_TIMEOUT_HOURS;
  const hours = raw ? parseInt(raw, 10) : NaN;
  return (
    (Number.isFinite(hours) && hours > 0
      ? hours
      : DEFAULT_ABSOLUTE_TIMEOUT_HOURS) *
    60 *
    60 *
    1000
  );
}

// ---------------------------------------------------------------------------
// Pure timeout check — no I/O, easily testable
// ---------------------------------------------------------------------------

export type SessionTimeoutResult = {
  expired: boolean;
  reason?: "idle" | "absolute";
};

/**
 * Check whether the session has exceeded either timeout window.
 *
 * @param loginAt     - `ss_login_at` cookie value (ms-epoch string), or undefined
 * @param lastActivity - `ss_last_activity` cookie value (ms-epoch string), or undefined
 * @param now          - current time in ms (defaults to Date.now())
 * @param idleMs       - idle timeout in ms (pass explicitly for tests)
 * @param absoluteMs   - absolute timeout in ms (pass explicitly for tests)
 *
 * When `loginAt` is missing the session predates this feature; it is treated
 * as expired so the user re-authenticates with the new flow (one-time).
 */
export function checkSessionTimeout(
  loginAt: string | undefined,
  lastActivity: string | undefined,
  now: number = Date.now(),
  idleMs: number = getIdleTimeoutMs(),
  absoluteMs: number = getAbsoluteTimeoutMs()
): SessionTimeoutResult {
  // No login stamp → session predates this feature → force re-auth.
  if (!loginAt) {
    return { expired: true, reason: "absolute" };
  }

  const loginTs = parseInt(loginAt, 10);
  if (!Number.isFinite(loginTs)) {
    return { expired: true, reason: "absolute" };
  }

  // Absolute lifetime check.
  if (now - loginTs > absoluteMs) {
    return { expired: true, reason: "absolute" };
  }

  // Idle timeout check — only if we have a last-activity stamp.
  if (lastActivity) {
    const activityTs = parseInt(lastActivity, 10);
    if (Number.isFinite(activityTs) && now - activityTs > idleMs) {
      return { expired: true, reason: "idle" };
    }
  }

  return { expired: false };
}

// ---------------------------------------------------------------------------
// Cookie options — shared by middleware and callback
// ---------------------------------------------------------------------------

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
