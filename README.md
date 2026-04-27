# Sole Supply

A small web app for a sneaker-importing workflow from the US to Addis Ababa, Ethiopia.

## What it does

- **Contact person (submitter)** signs in, pastes product URLs into `/submit`. The app scrapes image, title, and price.
- **Admin** (you) uses `/admin` to move shoes through `upcoming → available → sold`, invite submitters, promote users, and see who's interested in which shoe.
- **Customers** browse the homepage; when signed in they can tap "I want this" on any shoe. You see the list in `/admin` and reach out off-app.

## Stack

- Next.js 14 (App Router) + TypeScript
- Supabase Postgres + Supabase Auth (email magic links)
- Tailwind CSS
- Deployed on Vercel

## Roles

| Role | How assigned | Can |
|---|---|---|
| `admin` | Email is in the `ADMIN_EMAILS` list (see SQL below) | Everything |
| `submitter` | Invited by admin from `/admin` → Users | Add shoes at `/submit` |
| `customer` | Default for anyone who signs up themselves | Express interest on `/` |

## First-time setup

### 1. Supabase project

- Create a project at [supabase.com](https://supabase.com).
- SQL Editor → paste each file in [`supabase/migrations/`](supabase/migrations/) in numeric order → Run. See [`supabase/migrations/README.md`](supabase/migrations/README.md) for the workflow as more migrations land.
- Whitelist the admin email(s) so the signup trigger auto-promotes them:
  ```sql
  alter database postgres set app.admin_emails = 'your-email@example.com';
  ```
  To add more later, re-run with the full comma-separated list.
- Authentication → URL Configuration:
  - **Site URL**: `https://your-live-url.vercel.app` (or `http://localhost:3000` for dev)
  - **Redirect URLs**: add both your live URL and `http://localhost:3000`, each with `/auth/callback` as the path.
- Authentication → Providers → Email: make sure "Confirm email" is enabled (default).

### 2. Environment

Copy `.env.example` → `.env.local` and fill in. You need:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SITE_URL` — your deployed URL (or `http://localhost:3000` for dev)

### 3. Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Click **Sign in** in the header, enter your (whitelisted) email, open the magic link. You should see **Admin** and **Submit** tabs in the header.

## Day-to-day

- **Invite a submitter**: `/admin` → Users tab → enter email, role `submitter` → Send invite. They get a magic-link email.
- **Handle interest**: `/admin` → Interests tab lists every "I want this" grouped by shoe, with the customer's email, size, and notes. Reach out to them directly.
- **Move a shoe to available/sold**: `/admin` → Shoes tab → change the status dropdown.

## Deploying to Vercel

1. Push to GitHub.
2. Import the repo into Vercel.
3. Add env vars in Project Settings → Environment Variables (same four as `.env.local`).
4. Deploy, then go back to Supabase → Auth → URL Configuration and add the Vercel URL + redirect URL.

## Notes and assumptions

- No automated checkout. A human buys the shoe from the retailer. This app is a procurement queue + storefront preview + interest tracker.
- Scraper uses Open Graph meta tags only; some JS-heavy retailers may not return data. You can edit rows directly in Supabase's Table Editor if needed.
- Brands are auto-detected from hostname; add new ones in [`lib/brand.ts`](lib/brand.ts).
- Prices are stored in USD. No FX conversion.
- Admins can't demote themselves from the Users tab (to avoid accidental lockout).
