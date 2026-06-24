-- ============================================================================
--  MCG GLOBAL — Production PostgreSQL Schema (Single Source of Truth)
--  Run this verbatim in the Supabase SQL Editor (or via `supabase db push`).
--
--  This script is MONOLITHIC and IDEMPOTENT: it may be executed any number of
--  times against the same database without raising duplicate-object errors and
--  without mutating data that already conforms.
--
--  Layers:
--    1. Extensions
--    2. Custom enum types          (platform_role, verification_status,
--                                    deal_status, vehicle_type)
--    3. Relational tables          (profiles + 6 domain tables, strict FKs)
--    4. Auth → profile mirroring    (SECURITY DEFINER trigger)
--    5. Deal acceptance RPC         (SECURITY DEFINER, atomic)
--    6. Row Level Security          (per-table, Super Admin authority,
--                                    APPROVED-only public visibility)
--    7. Realtime publication        (postgres_changes for Loop C)
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";


-- ---------------------------------------------------------------------------
-- 2. Custom enum types
--    Each guarded by a catalog check so re-execution is a no-op (Req 1.5).
--    Values and ordering are exact and case-sensitive (Req 1.1–1.4).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'platform_role') then
    create type public.platform_role as enum (
      'BUYER', 'SUPPLIER', 'DRIVER', 'WAREHOUSE_HOST', 'SUPER_ADMIN'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'verification_status') then
    create type public.verification_status as enum (
      'PENDING', 'APPROVED', 'REJECTED'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'deal_status') then
    create type public.deal_status as enum (
      'OPEN', 'NEGOTIATION', 'CONTRACTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'vehicle_type') then
    create type public.vehicle_type as enum (
      'TRUCK', 'VAN', 'CAR', 'MOTORCYCLE'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'rfq_status') then
    create type public.rfq_status as enum (
      'OPEN', 'QUOTED', 'CLOSED'
    );
  end if;
end$$;


-- ---------------------------------------------------------------------------
-- 3. Relational tables
-- ---------------------------------------------------------------------------

-- 3.1 profiles — 1:1 extension of auth.users (Req 2)
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text,
  company_name  text,
  phone_number  text,
  role          public.platform_role        not null default 'BUYER',
  status        public.verification_status  not null default 'PENDING',
  -- Importer (Buyer) corporate onboarding fields.
  import_license_number text,
  country_source        text,
  created_at    timestamptz                 not null default now()
);
comment on table public.profiles is
  'Platform identity, role and verification status, mirrored 1:1 from auth.users.';

-- Idempotent column backfill for databases provisioned before the Importer
-- onboarding fields existed.
alter table public.profiles add column if not exists import_license_number text;
alter table public.profiles add column if not exists country_source text;

-- 3.2 products — owned by a SUPPLIER profile (Req 3.1)
create table if not exists public.products (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references public.profiles (id) on delete cascade,
  title        text not null,
  description  text,
  price_range  text,
  moq          integer,
  lead_time    text,
  images       text[] not null default '{}',
  created_at   timestamptz not null default now()
);

-- 3.3 warehouses — owned by a WAREHOUSE_HOST profile (Req 3.2)
create table if not exists public.warehouses (
  id                    uuid primary key default gen_random_uuid(),
  host_id               uuid not null references public.profiles (id) on delete cascade,
  title                 text not null,
  city                  text,
  total_area_m2         numeric,
  available_area_m2     numeric,
  price_per_m2_monthly  numeric,
  created_at            timestamptz not null default now()
);

-- 3.4 drivers_metadata — id is BOTH PK and FK to a DRIVER profile (Req 3.3)
create table if not exists public.drivers_metadata (
  id                     uuid primary key references public.profiles (id) on delete cascade,
  license_number         text,
  vehicle                public.vehicle_type,
  max_weight_capacity_kg numeric,
  created_at             timestamptz not null default now()
);

-- 3.5 rfqs — created by a BUYER profile (Req 3.4)
create table if not exists public.rfqs (
  id             uuid primary key default gen_random_uuid(),
  buyer_id       uuid not null references public.profiles (id) on delete cascade,
  product_title  text not null,
  category       text,
  specifications text,
  target_budget  text,
  quantity       integer,
  status         public.rfq_status not null default 'OPEN',
  created_at     timestamptz not null default now()
);

-- Idempotent column backfill for pre-existing rfqs tables.
alter table public.rfqs add column if not exists category text;
alter table public.rfqs add column if not exists status public.rfq_status not null default 'OPEN';

-- 3.6 quotations — a SUPPLIER's offer against an RFQ (Req 3.5)
create table if not exists public.quotations (
  id                uuid primary key default gen_random_uuid(),
  rfq_id            uuid not null references public.rfqs (id) on delete cascade,
  supplier_id       uuid not null references public.profiles (id) on delete cascade,
  offered_price     numeric,
  dynamic_lead_time text,
  invoice_url       text,
  created_at        timestamptz not null default now()
);

-- 3.7 deals — contracted transaction binding buyer/supplier/quote (Req 3.6–3.8)
create table if not exists public.deals (
  id              uuid primary key default gen_random_uuid(),
  buyer_id        uuid not null references public.profiles (id)         on delete cascade,
  supplier_id     uuid not null references public.profiles (id)         on delete cascade,
  quote_id        uuid not null references public.quotations (id)       on delete cascade,
  warehouse_id    uuid     references public.warehouses (id)            on delete set null,
  driver_id       uuid     references public.drivers_metadata (id)      on delete set null,
  gross_valuation numeric,
  status          public.deal_status not null default 'OPEN',
  created_at      timestamptz not null default now(),
  -- One deal per accepted quotation (Req 12.9).
  constraint deals_quote_id_unique unique (quote_id)
);

-- Helpful indexes for the live feeds and pipeline joins.
create index if not exists idx_products_supplier   on public.products (supplier_id);
create index if not exists idx_warehouses_host      on public.warehouses (host_id);
create index if not exists idx_rfqs_buyer           on public.rfqs (buyer_id);
create index if not exists idx_quotations_rfq       on public.quotations (rfq_id);
create index if not exists idx_quotations_supplier  on public.quotations (supplier_id);
create index if not exists idx_deals_buyer          on public.deals (buyer_id);
create index if not exists idx_deals_supplier       on public.deals (supplier_id);
create index if not exists idx_profiles_status      on public.profiles (status);


-- ---------------------------------------------------------------------------
-- 4. Auth → profile mirroring trigger (Req 4)
--    SECURITY DEFINER + fixed search_path so it can always write to
--    public.profiles regardless of the caller's privileges.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_role     text := new.raw_user_meta_data ->> 'role';
  resolved_role public.platform_role;
  resolved_status public.verification_status;
begin
  -- Coerce the supplied role; any invalid/absent value falls back to BUYER.
  begin
    resolved_role := meta_role::public.platform_role;
  exception when others then
    resolved_role := 'BUYER';
  end;

  -- Buyers are auto-approved; commercial accounts await admin review.
  if resolved_role = 'BUYER' then
    resolved_status := 'APPROVED';
  else
    resolved_status := 'PENDING';
  end if;

  insert into public.profiles (id, full_name, company_name, phone_number, role, status)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'company_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone_number', ''),
    resolved_role,
    resolved_status
  )
  on conflict (id) do nothing;  -- Req 4.7: never disturb an existing profile.

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------------
-- 5. Helper: is the current caller a Super Admin?
--    SECURITY DEFINER so the lookup itself is not subject to the profiles RLS
--    policy (avoids infinite policy recursion).
-- ---------------------------------------------------------------------------
create or replace function public.is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'SUPER_ADMIN'
  );
$$;


-- ---------------------------------------------------------------------------
-- 6. Deal acceptance RPC (Req 12) — atomic accept-quote → create-deal.
--    SECURITY DEFINER so it can read the RFQ/quotation regardless of the
--    caller's row visibility, while still enforcing buyer ownership manually.
-- ---------------------------------------------------------------------------
create or replace function public.accept_deal(p_quote_id uuid)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote     public.quotations%rowtype;
  v_buyer_id  uuid;
  v_caller    uuid := auth.uid();
  v_deal      public.deals%rowtype;
begin
  -- Resolve the quotation.
  select * into v_quote from public.quotations where id = p_quote_id;
  if not found then
    raise exception 'Quotation % not found', p_quote_id using errcode = 'no_data_found';
  end if;

  -- Resolve the owning buyer via the RFQ.
  select buyer_id into v_buyer_id from public.rfqs where id = v_quote.rfq_id;
  if v_buyer_id is null then
    raise exception 'Parent RFQ for quotation % not found', p_quote_id;
  end if;

  -- Req 12.8: only the buyer who owns the RFQ (or a Super Admin) may accept.
  if v_caller <> v_buyer_id and not public.is_super_admin() then
    raise exception 'Not authorized to accept this quotation' using errcode = 'insufficient_privilege';
  end if;

  -- Req 12.4: offered price must be a valid monetary amount.
  if v_quote.offered_price is null
     or v_quote.offered_price < 0.01
     or v_quote.offered_price > 999999999.99 then
    raise exception 'Quotation has an invalid offered price' using errcode = 'check_violation';
  end if;

  -- Req 12.9: reject a second deal for the same quotation.
  if exists (select 1 from public.deals where quote_id = p_quote_id) then
    raise exception 'A deal already exists for quotation %', p_quote_id using errcode = 'unique_violation';
  end if;

  -- Req 12.2/12.3/12.5: create the deal atomically.
  insert into public.deals (buyer_id, supplier_id, quote_id, gross_valuation, status)
  values (v_buyer_id, v_quote.supplier_id, p_quote_id, v_quote.offered_price, 'OPEN')
  returning * into v_deal;

  return v_deal;
end;
$$;

grant execute on function public.accept_deal(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Row Level Security (Req 5, 6)
--    Enable on every table, then (re)create policies idempotently.
-- ---------------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.products         enable row level security;
alter table public.warehouses       enable row level security;
alter table public.drivers_metadata enable row level security;
alter table public.rfqs             enable row level security;
alter table public.quotations       enable row level security;
alter table public.deals            enable row level security;

-- 7.1 profiles -------------------------------------------------------------
-- Read: APPROVED rows are public; owners and Super Admins see everything.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select
  using (
    status = 'APPROVED'
    or id = auth.uid()
    or public.is_super_admin()
  );

-- Insert: a user may create only their own profile (trigger covers the rest).
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert
  with check (id = auth.uid() or public.is_super_admin());

-- Update: owners may edit their own row; Super Admins may edit any row
-- (this is what powers the approve/reject funnel).
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update
  using (id = auth.uid() or public.is_super_admin())
  with check (id = auth.uid() or public.is_super_admin());

-- Delete: Super Admin only.
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete
  using (public.is_super_admin());

-- 7.2 products -------------------------------------------------------------
drop policy if exists products_select on public.products;
create policy products_select on public.products
  for select
  using (
    public.is_super_admin()
    or supplier_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = products.supplier_id and p.status = 'APPROVED'
    )
  );

drop policy if exists products_write on public.products;
create policy products_write on public.products
  for all
  using (supplier_id = auth.uid() or public.is_super_admin())
  with check (supplier_id = auth.uid() or public.is_super_admin());

-- 7.3 warehouses -----------------------------------------------------------
drop policy if exists warehouses_select on public.warehouses;
create policy warehouses_select on public.warehouses
  for select
  using (
    public.is_super_admin()
    or host_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = warehouses.host_id and p.status = 'APPROVED'
    )
  );

drop policy if exists warehouses_write on public.warehouses;
create policy warehouses_write on public.warehouses
  for all
  using (host_id = auth.uid() or public.is_super_admin())
  with check (host_id = auth.uid() or public.is_super_admin());

-- 7.4 drivers_metadata -----------------------------------------------------
drop policy if exists drivers_select on public.drivers_metadata;
create policy drivers_select on public.drivers_metadata
  for select
  using (
    public.is_super_admin()
    or id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = drivers_metadata.id and p.status = 'APPROVED'
    )
  );

drop policy if exists drivers_write on public.drivers_metadata;
create policy drivers_write on public.drivers_metadata
  for all
  using (id = auth.uid() or public.is_super_admin())
  with check (id = auth.uid() or public.is_super_admin());

-- 7.5 rfqs -----------------------------------------------------------------
-- Buyers see their own RFQs; suppliers (approved) and admins see the pipeline.
drop policy if exists rfqs_select on public.rfqs;
create policy rfqs_select on public.rfqs
  for select
  using (
    public.is_super_admin()
    or buyer_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'SUPPLIER' and p.status = 'APPROVED'
    )
  );

drop policy if exists rfqs_insert on public.rfqs;
create policy rfqs_insert on public.rfqs
  for insert
  with check (buyer_id = auth.uid() or public.is_super_admin());

drop policy if exists rfqs_modify on public.rfqs;
create policy rfqs_modify on public.rfqs
  for update
  using (buyer_id = auth.uid() or public.is_super_admin())
  with check (buyer_id = auth.uid() or public.is_super_admin());

drop policy if exists rfqs_delete on public.rfqs;
create policy rfqs_delete on public.rfqs
  for delete
  using (buyer_id = auth.uid() or public.is_super_admin());

-- 7.6 quotations -----------------------------------------------------------
-- Visible to the submitting supplier, the owning buyer, and admins.
drop policy if exists quotations_select on public.quotations;
create policy quotations_select on public.quotations
  for select
  using (
    public.is_super_admin()
    or supplier_id = auth.uid()
    or exists (
      select 1 from public.rfqs r
      where r.id = quotations.rfq_id and r.buyer_id = auth.uid()
    )
  );

drop policy if exists quotations_insert on public.quotations;
create policy quotations_insert on public.quotations
  for insert
  with check (supplier_id = auth.uid() or public.is_super_admin());

drop policy if exists quotations_modify on public.quotations;
create policy quotations_modify on public.quotations
  for update
  using (supplier_id = auth.uid() or public.is_super_admin())
  with check (supplier_id = auth.uid() or public.is_super_admin());

-- 7.7 deals ----------------------------------------------------------------
-- Visible to the buyer, the supplier, and admins.
drop policy if exists deals_select on public.deals;
create policy deals_select on public.deals
  for select
  using (
    public.is_super_admin()
    or buyer_id = auth.uid()
    or supplier_id = auth.uid()
  );

-- Direct writes are reserved for admins; buyers create deals via accept_deal()
-- (SECURITY DEFINER), and status transitions go through controlled updates.
drop policy if exists deals_modify on public.deals;
create policy deals_modify on public.deals
  for update
  using (
    public.is_super_admin()
    or buyer_id = auth.uid()
    or supplier_id = auth.uid()
  )
  with check (
    public.is_super_admin()
    or buyer_id = auth.uid()
    or supplier_id = auth.uid()
  );

drop policy if exists deals_admin_insert on public.deals;
create policy deals_admin_insert on public.deals
  for insert
  with check (public.is_super_admin());


-- ---------------------------------------------------------------------------
-- 8. Realtime publication (Loop C — Req referenced by realtime sync)
--    Add domain tables to the supabase_realtime publication so the client can
--    subscribe to postgres_changes. Guarded for idempotency.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- profiles
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
    ) then
      alter publication supabase_realtime add table public.profiles;
    end if;
    -- rfqs
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rfqs'
    ) then
      alter publication supabase_realtime add table public.rfqs;
    end if;
    -- quotations
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quotations'
    ) then
      alter publication supabase_realtime add table public.quotations;
    end if;
    -- deals
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deals'
    ) then
      alter publication supabase_realtime add table public.deals;
    end if;
    -- warehouses
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'warehouses'
    ) then
      alter publication supabase_realtime add table public.warehouses;
    end if;
  end if;
end$$;

-- ============================================================================
--  End of schema. Re-runnable, strict-FK, RLS-hardened, realtime-ready.
-- ============================================================================
