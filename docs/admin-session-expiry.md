# Admin Session Expiry

## Problem

Supabase Auth with `@supabase/ssr` rolling-refreshes the session token on every navigation (via `middleware.ts` calling `getUser()`). This means authenticated sessions effectively never expire as long as the admin keeps visiting the site.

## Solution

Server-side session timeout enforced via two HttpOnly cookies, checked in middleware on every authenticated request.

### Two timeout windows

| Window | Cookie | Default | Env var |
|--------|--------|---------|---------|
| **Idle timeout** | `ss_last_activity` | 30 minutes | `SESSION_IDLE_TIMEOUT_MINUTES` |
| **Absolute lifetime** | `ss_login_at` | 8 hours | `SESSION_ABSOLUTE_TIMEOUT_HOURS` |

- **Idle**: resets on every request. If the user does nothing for 30 min, the next request triggers sign-out.
- **Absolute**: set once at login. After 8 hours, the user must re-authenticate regardless of activity.

### Enforcement points

1. **`app/auth/callback/route.ts`** -- after exchanging the magic-link code for a session, stamps both `ss_login_at` and `ss_last_activity` cookies.
2. **`middleware.ts`** -- on every request (except `/auth/*` routes, to prevent redirect loops):
   - Calls `supabase.auth.getUser()` to refresh the Supabase token (existing behavior).
   - Checks the two cookies via `checkSessionTimeout()`.
   - If expired: calls `signOut()`, clears all session cookies, redirects to `/auth/sign-in?session=expired`.
   - If valid: updates `ss_last_activity` to extend the idle window.
3. **`app/auth/sign-out/route.ts`** -- clears both cookies alongside the Supabase sign-out.

### Cookie properties

Both cookies are `HttpOnly`, `Secure` (in production), `SameSite=Lax`, `Path=/`. They store plain millisecond timestamps. They contain no user-identifiable data.

### Applies to all authenticated roles

The timeout applies equally to admin and shipper sessions. There is no role-specific timeout; the distinction is that only admin and shipper roles can reach `/admin`, and customers rarely have long-lived sessions since they browse without signing in.

### First deploy behavior

Existing sessions (logged in before this feature) will not have the `ss_login_at` cookie. The middleware treats a missing cookie as expired, forcing a one-time re-authentication. This is intentional and expected.

### No schema change

This feature uses cookies only. No database migration is needed.

## Files

- `lib/session-timeout.ts` -- pure timeout logic + cookie constants
- `middleware.ts` -- enforcement
- `app/auth/callback/route.ts` -- cookie stamping on login
- `app/auth/sign-out/route.ts` -- cookie clearing on logout
- `app/auth/sign-in/page.tsx` -- "session expired" banner
