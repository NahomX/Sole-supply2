-- 0015_seed_telegram_admin — seed the owner's Telegram admin allowlist entry.
--
-- Data/seed migration (per migrations/README, seeds get their own numbered file).
-- Idempotent: upserts on the telegram_id primary key; safe to re-run.
-- telegram_id is the owner's Telegram numeric ID (public, not a secret).
--
-- Note: 0014 is reserved by PR #42 (feat/multi-image-variants, shoe_variants +
-- shoe_images tables). This file uses 0015 to avoid renumbering.

insert into public.telegram_users (telegram_id, role, label)
values (439295764, 'admin', 'Nahom')
on conflict (telegram_id) do update
  set role = excluded.role, label = excluded.label;
