-- Migration 003: Row Level Security for multi-operator isolation
--
-- Identity model:
--   Each authenticated user carries a JWT with:
--     app_metadata.cooperative_id  (uuid)  — the operator's cooperative
--     app_metadata.role            (text)  — 'admin' for super-users
--
-- Helper to extract the cooperative_id claim from the current JWT.
create or replace function auth.cooperative_id() returns uuid
  language sql stable
  as $$
    select (auth.jwt() -> 'app_metadata' ->> 'cooperative_id')::uuid
  $$;

-- Helper: true when the caller is an admin.
create or replace function auth.is_admin() returns boolean
  language sql stable
  as $$
    select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
  $$;

-- ── cooperatives ────────────────────────────────────────────────────────────
alter table cooperatives enable row level security;

create policy "operators: own cooperative"
  on cooperatives for all
  using (id = auth.cooperative_id() or auth.is_admin());

-- ── meters ───────────────────────────────────────────────────────────────────
alter table meters enable row level security;

create policy "operators: own meters"
  on meters for all
  using (cooperative_id = auth.cooperative_id() or auth.is_admin());

-- ── readings ─────────────────────────────────────────────────────────────────
-- readings have no cooperative_id; scope via the parent meter.
alter table readings enable row level security;

create policy "operators: own readings"
  on readings for all
  using (
    auth.is_admin()
    or exists (
      select 1 from meters m
      where m.id = readings.meter_id
        and m.cooperative_id = auth.cooperative_id()
    )
  );

-- ── certificates ─────────────────────────────────────────────────────────────
alter table certificates enable row level security;

create policy "operators: own certificates"
  on certificates for all
  using (cooperative_id = auth.cooperative_id() or auth.is_admin());

-- ── marketplace_listings ─────────────────────────────────────────────────────
-- Off-chain listings of certificates for peer-to-peer transfer between
-- cooperatives. Escrow and payment are out of scope for v1 (manual settlement).
create table marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null references certificates (id) on delete cascade,
  seller_cooperative_id uuid not null references cooperatives (id),
  asking_price numeric(12, 2) not null check (asking_price >= 0),
  currency text not null default 'EUR',
  status text not null default 'active'
    check (status in ('active', 'sold', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index marketplace_listings_active_idx
  on marketplace_listings (created_at desc)
  where status = 'active';

create index marketplace_listings_seller_idx
  on marketplace_listings (seller_cooperative_id);

alter table marketplace_listings enable row level security;

-- Any authenticated operator may browse active listings.
create policy "operators: read active listings"
  on marketplace_listings for select
  using (
    auth.is_admin()
    or status = 'active'
    or seller_cooperative_id = auth.cooperative_id()
  );

-- Sellers may create listings only for their own cooperative.
create policy "operators: create own listings"
  on marketplace_listings for insert
  with check (
    auth.is_admin()
    or seller_cooperative_id = auth.cooperative_id()
  );

-- Sellers may update their own listings.
create policy "operators: update own listings"
  on marketplace_listings for update
  using (seller_cooperative_id = auth.cooperative_id() or auth.is_admin())
  with check (seller_cooperative_id = auth.cooperative_id() or auth.is_admin());

-- Sellers may delete their own listings.
create policy "operators: delete own listings"
  on marketplace_listings for delete
  using (seller_cooperative_id = auth.cooperative_id() or auth.is_admin());
