-- 0014_shoe_variants_images — add shoe_variants + shoe_images tables.
--
-- shoe_variants: selectable color options for storefront presentation.
-- shoe_images: multi-view image set per shoe (optionally scoped to a variant).
--
-- Both tables are additive. shoes.image_url is preserved as the primary/fallback
-- image — the storefront falls back to it when a shoe has no shoe_images rows.
-- shoe_sizes is NOT touched — variants are a STOREFRONT PRESENTATION concept
-- only; size/logistics data remains shoe-level via shoe_sizes.
--
-- Idempotent: uses DO blocks that check for table existence before creating.

-- ---------------------------------------------------------------------------
-- shoe_variants
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'shoe_variants'
  ) then
    create table public.shoe_variants (
      id uuid primary key default gen_random_uuid(),
      shoe_id uuid not null references public.shoes(id) on delete cascade,
      color_name text not null,
      swatch_hex text,          -- e.g. '#FF0000'; nullable (use swatch_image_url instead)
      swatch_image_url text,    -- nullable; alternative to a solid-color swatch
      sort_order integer not null default 0,
      created_at timestamptz not null default now()
    );

    create index idx_shoe_variants_shoe_id on public.shoe_variants(shoe_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- shoe_images
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'shoe_images'
  ) then
    create table public.shoe_images (
      id uuid primary key default gen_random_uuid(),
      shoe_id uuid not null references public.shoes(id) on delete cascade,
      variant_id uuid references public.shoe_variants(id) on delete cascade,  -- null = applies to base shoe / all variants
      url text not null,
      view_type text not null default 'hero',
      sort_order integer not null default 0,
      created_at timestamptz not null default now(),

      -- view_type must be one of the known view types
      constraint shoe_images_view_type_check
        check (view_type in ('hero', 'zoom', 'side', 'top', 'back', 'sole', 'lifestyle'))
    );

    create index idx_shoe_images_shoe_id on public.shoe_images(shoe_id);
    create index idx_shoe_images_variant_id on public.shoe_images(variant_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS policies — admin-only write; public read (images are shown on storefront)
-- ---------------------------------------------------------------------------

-- shoe_variants: enable RLS, allow public read, admin write
do $$
begin
  alter table public.shoe_variants enable row level security;
exception when others then null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'shoe_variants' and policyname = 'shoe_variants_select_all'
  ) then
    create policy shoe_variants_select_all on public.shoe_variants
      for select using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'shoe_variants' and policyname = 'shoe_variants_admin_all'
  ) then
    create policy shoe_variants_admin_all on public.shoe_variants
      for all using (public.is_admin(auth.uid()))
      with check (public.is_admin(auth.uid()));
  end if;
end $$;

-- shoe_images: enable RLS, allow public read, admin write
do $$
begin
  alter table public.shoe_images enable row level security;
exception when others then null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'shoe_images' and policyname = 'shoe_images_select_all'
  ) then
    create policy shoe_images_select_all on public.shoe_images
      for select using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'shoe_images' and policyname = 'shoe_images_admin_all'
  ) then
    create policy shoe_images_admin_all on public.shoe_images
      for all using (public.is_admin(auth.uid()))
      with check (public.is_admin(auth.uid()));
  end if;
end $$;
