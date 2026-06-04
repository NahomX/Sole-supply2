-- 0005_shoe_sizes — per-size logistics status table.
--
-- Replaces the single shoes.logistics_status column with one row per
-- (shoe, US size) in shoe_sizes. Each row tracks its own logistics status
-- through the pipeline: null → in_cart → purchased → arrived → delivered.
--
-- Changes:
--   1. Create public.shoe_sizes (if not exists) — idempotent.
--   2. Backfill: for every existing shoe, parse shoes.sizes (free-text) into
--      canonical US size strings (replicating the parseAvailableSizes logic
--      from lib/sizes.ts) and insert one shoe_sizes row per parsed size.
--      Each backfilled row inherits logistics_status = shoes.logistics_status.
--      Garbled/empty sizes produce no rows — the storefront already shows
--      "Sizes TBA" for those shoes, so this is the correct fallback.
--   3. Drop shoes.logistics_status — now superseded by shoe_sizes.
--
-- shoes.sizes (free-text input label) is NOT dropped — it is kept as a
-- convenience display/sync field. The Phase 1 code uses it only for
-- syncSizesFromText; the authoritative size+status source is shoe_sizes.
--
-- Idempotent: safe to re-run. Step 1 uses CREATE TABLE IF NOT EXISTS + IF NOT
-- EXISTS on the index and policy. Step 2 uses INSERT … ON CONFLICT DO NOTHING.
-- Step 3 uses a DO block that checks whether the column still exists.

-- ---------------------------------------------------------------------------
-- Step 1 — create shoe_sizes table + index + RLS
-- ---------------------------------------------------------------------------

create table if not exists public.shoe_sizes (
  id uuid primary key default gen_random_uuid(),
  shoe_id uuid not null references public.shoes(id) on delete cascade,
  us_size text not null,                -- canonical US string from SIZE_GRID, e.g. "9", "10.5"
  logistics_status text                 -- null = listed / not yet started
    check (logistics_status is null or logistics_status in ('in_cart','purchased','arrived','delivered')),
  created_at timestamptz not null default now(),
  unique (shoe_id, us_size)
);

create index if not exists shoe_sizes_shoe_idx on public.shoe_sizes (shoe_id);

alter table public.shoe_sizes enable row level security;

-- Public read: size + status are non-sensitive (no url, no user data).
-- Writes go through the service-role client in the API layer (mirrors shoes).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'shoe_sizes'
      and policyname = 'shoe_sizes public read'
  ) then
    execute $p$
      create policy "shoe_sizes public read"
        on public.shoe_sizes
        for select
        using (true)
    $p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Step 2 — backfill shoe_sizes from shoes.sizes free-text
--
-- Parsing logic mirrors parseAvailableSizes in lib/sizes.ts:
--   • Split on [,;|/]+ or whitespace runs (not on "-").
--   • Expand integer ranges "lo-hi" → lo..hi (whole numbers, max 20 span).
--   • Strip leading/trailing label chars (US, EU, quotes).
--   • Accept direct US grid hits (7, 7.5 … 13).
--   • Accept EU→US via the canonical conversion table.
--   • Silently ignore tokens that match nothing.
--
-- The US↔EU table below must stay in sync with SIZE_GRID in lib/sizes.ts.
-- ---------------------------------------------------------------------------

do $$
declare
  rec           record;
  token         text;
  tokens        text[];
  cleaned       text;
  range_match   text[];
  lo            int;
  hi            int;
  i             int;
  s             text;
  us_val        text;
  inherited_ls  text;

  -- Canonical EU → US map (14 half-sizes, US 7–13)
  eu_us         text[][] := ARRAY[
    ARRAY['40',   '7'   ],
    ARRAY['40.5', '7.5' ],
    ARRAY['41',   '8'   ],
    ARRAY['42',   '8.5' ],
    ARRAY['42.5', '9'   ],
    ARRAY['43',   '9.5' ],
    ARRAY['44',   '10'  ],
    ARRAY['44.5', '10.5'],
    ARRAY['45',   '11'  ],
    ARRAY['45.5', '11.5'],
    ARRAY['46',   '12'  ],
    ARRAY['47',   '12.5'],
    ARRAY['47.5', '13'  ]
  ];

  -- Valid US size strings
  valid_us      text[] := ARRAY[
    '7','7.5','8','8.5','9','9.5','10','10.5','11','11.5','12','12.5','13'
  ];

begin
  for rec in select id, sizes, logistics_status from public.shoes loop
    inherited_ls := rec.logistics_status;

    -- Skip shoes with no sizes text
    if rec.sizes is null or trim(rec.sizes) = '' then
      continue;
    end if;

    -- Split on comma / semicolon / pipe / slash / whitespace runs
    tokens := regexp_split_to_array(rec.sizes, '[,;|/]+|\s+');

    for j in 1 .. array_length(tokens, 1) loop
      token := trim(tokens[j]);
      if token = '' then continue; end if;

      -- Try integer range expansion: "8-12"
      range_match := regexp_match(token, '^(\d+)\s*[-–—]\s*(\d+)$');
      if range_match is not null then
        lo := range_match[1]::int;
        hi := range_match[2]::int;
        if hi > lo and hi - lo <= 20 then
          for i in lo .. hi loop
            s := i::text;
            -- Check direct US hit
            if s = any(valid_us) then
              insert into public.shoe_sizes (shoe_id, us_size, logistics_status)
              values (rec.id, s, inherited_ls)
              on conflict (shoe_id, us_size) do nothing;
            else
              -- Check EU → US
              us_val := null;
              for k in 1 .. array_length(eu_us, 1) loop
                if eu_us[k][1] = s then us_val := eu_us[k][2]; exit; end if;
              end loop;
              if us_val is not null then
                insert into public.shoe_sizes (shoe_id, us_size, logistics_status)
                values (rec.id, us_val, inherited_ls)
                on conflict (shoe_id, us_size) do nothing;
              end if;
            end if;
          end loop;
        end if;
        continue;
      end if;

      -- Clean single token: strip leading/trailing label chars (US, EU, quotes, letters)
      cleaned := token;
      cleaned := regexp_replace(cleaned, '^["\'']+|["\'']+$', '', 'g');
      cleaned := trim(cleaned);
      cleaned := regexp_replace(cleaned, '^[a-zA-Z\s]+', '');
      cleaned := regexp_replace(cleaned, '[a-zA-Z\s]+$', '');
      cleaned := trim(cleaned);

      if cleaned = '' then continue; end if;
      -- Must look like a number
      if cleaned !~ '^\d+(\.\d+)?$' then continue; end if;

      -- Check direct US hit
      if cleaned = any(valid_us) then
        insert into public.shoe_sizes (shoe_id, us_size, logistics_status)
        values (rec.id, cleaned, inherited_ls)
        on conflict (shoe_id, us_size) do nothing;
        continue;
      end if;

      -- Check EU → US
      us_val := null;
      for k in 1 .. array_length(eu_us, 1) loop
        if eu_us[k][1] = cleaned then us_val := eu_us[k][2]; exit; end if;
      end loop;
      if us_val is not null then
        insert into public.shoe_sizes (shoe_id, us_size, logistics_status)
        values (rec.id, us_val, inherited_ls)
        on conflict (shoe_id, us_size) do nothing;
      end if;
      -- Tokens matching neither grid are silently ignored (lenient, same as TS)

    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Step 3 — drop shoes.logistics_status (now superseded by shoe_sizes)
--
-- Done in a DO block so this step is idempotent: if the column was already
-- dropped by a previous run, the block skips silently.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'shoes'
      and column_name  = 'logistics_status'
  ) then
    -- Drop the check constraint first (required before dropping the column)
    declare
      c text;
    begin
      for c in
        select conname
        from pg_constraint
        where conrelid = 'public.shoes'::regclass
          and contype  = 'c'
          and pg_get_constraintdef(oid) ilike '%logistics_status%'
      loop
        execute 'alter table public.shoes drop constraint ' || quote_ident(c);
      end loop;
    end;

    alter table public.shoes drop column logistics_status;
  end if;
end $$;
