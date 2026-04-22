# Sole Supply

A small web app for a sneaker-importing workflow from the US to Addis Ababa, Ethiopia.

- A contact person in Ethiopia pastes product URLs (Nike, Adidas, Foot Locker, etc.) into `/submit`. The app scrapes the Open Graph image, title, and price.
- The owner uses `/admin` (password-gated) to move each shoe through `upcoming → available → sold` and to delete mistakes.
- The public homepage `/` shows shoes as "Coming soon" — image, brand, title. No ordering, no checkout.

## Stack

- Next.js 14 (App Router) + TypeScript
- Supabase (Postgres + service-role writes from API routes)
- Tailwind CSS
- Deployed on Vercel

## Setup

1. **Install**
   ```bash
   npm install
   ```

2. **Supabase**
   - Create a project at [supabase.com](https://supabase.com).
   - Open the SQL editor and run `supabase/schema.sql`.
   - Copy the project URL, anon key, and service-role key.

3. **Environment** — copy `.env.example` to `.env.local` and fill in:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ADMIN_PASSWORD=pick-a-strong-one
   ```

4. **Run**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000.

## Routes

| Route | Who | Purpose |
|---|---|---|
| `/` | public | Grid of upcoming shoes, sold section dimmed at the bottom. |
| `/submit` | private link (no auth) | Paste a URL, preview, add the shoe. Appears as `upcoming`. |
| `/admin` | password | Change status, delete entries. Password checked server-side. |

## Deploying to Vercel

1. Push to GitHub.
2. Import the repo in Vercel.
3. Add the four env vars from `.env.example` to the Vercel project.
4. Deploy.

## Notes and assumptions

- No automated checkout. A human buys the shoe from the retailer. This app is a procurement queue + storefront preview.
- The submit page is unauthenticated — treat the URL as a shared secret.
- Scraper uses only Open Graph meta tags; some retailers with heavy JS rendering may return nothing. You can edit the title/image after the fact via the database.
- Brands are auto-detected from hostname; add new ones in `lib/brand.ts`.
- Prices are stored in USD. No FX conversion.
