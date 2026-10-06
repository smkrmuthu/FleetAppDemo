-- Fleet Ledger — PostgreSQL base schema
-- Money is stored in paise (bigint). Never float.
-- Every tenant-scoped table carries org_id and is protected by RLS.

create extension if not exists "pgcrypto";

create type user_role         as enum ('driver', 'office', 'manager');
create type trip_status       as enum ('draft', 'pending', 'approved', 'void');
create type trip_expense_kind as enum ('diesel', 'adblue', 'toll', 'other');
create type cost_category     as enum (
  'loading_charges', 'unloading_charges', 'weighbridge_fee', 'detention',
  'maintenance', 'insurance', 'tyres', 'permit_tax', 'loan_lease', 'fine', 'other');
create type trip_doc_type     as enum ('waybill', 'weighbridge', 'other');

-- ── tenancy ────────────────────────────────────────────────────────────────
-- org_id is the unit of isolation this whole schema is built around: one row
-- here can be one transport company, or one fleet within a larger group —
-- the same tables and RLS policies serve either without change.
create table orgs (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  currency        char(3) not null default 'INR',
  fy_start_month  int  not null default 4,
  created_at      timestamptz not null default now()
);

create table branches (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references orgs on delete cascade,
  name     text not null
);

create table users (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs on delete cascade,
  branch_id     uuid references branches,
  role          user_role not null,
  full_name     text not null,
  phone         text not null,
  password_hash text,
  driver_id     uuid,                              -- set for role = 'driver'
  last_seen_at  timestamptz,
  disabled_at   timestamptz,
  unique (org_id, phone)
);

-- ── masters ────────────────────────────────────────────────────────────────
create table vehicles (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs on delete cascade,
  reg_no         text not null,
  model          text,
  tare_kg        int,
  fc_date        date,                             -- fitness certificate last issued/renewed
  fc_renewal_due date,                              -- next renewal deadline
  active         boolean not null default true,     -- soft delete; never hard delete
  unique (org_id, reg_no)
);
create index vehicles_fc_renewal_due on vehicles (org_id, fc_renewal_due)
  where active and fc_renewal_due is not null;

create table drivers (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs on delete cascade,
  branch_id       uuid references branches,
  full_name       text not null,
  phone           text,
  licence_no      text,
  licence_expiry  date,
  credential      text,                            -- yard pass, hazmat endorsement
  default_vehicle uuid references vehicles,
  active          boolean not null default true
);
alter table users add constraint users_driver_fk
  foreign key (driver_id) references drivers;
create index drivers_expiring on drivers (org_id, licence_expiry)
  where active and licence_expiry is not null;

-- ── movements (hot path, partitioned by month) ─────────────────────────────
-- No shipment/container hierarchy: a trip carries its own waybill and item
-- reference directly. Simpler than trade documentation, and it's what a
-- domestic goods-movement operation actually works from.
create table trips (
  id            uuid primary key,                  -- client-generated: offline safe
  org_id        uuid not null references orgs,
  vehicle_id    uuid not null references vehicles,
  driver_id     uuid references drivers,
  waybill_no    text,
  item_no       text,
  load_date     date not null,
  unload_date   date,
  from_loc      text,
  to_loc        text,
  weight_kg     int,
  odo_start     int,
  odo_end       int,
  revenue_paise bigint not null default 0,
  status        trip_status not null default 'draft',
  remarks       text,
  created_by    uuid references users,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (odo_end is null or odo_start is null or odo_end >= odo_start)
) partition by range (load_date);

-- one partition per month; create ahead with pg_partman or a monthly job
create table trips_2026_09 partition of trips
  for values from ('2026-09-01') to ('2026-10-01');
create table trips_2026_10 partition of trips
  for values from ('2026-10-01') to ('2026-11-01');

create index trips_org_veh_date    on trips (org_id, vehicle_id, load_date desc);
create index trips_org_driver_date on trips (org_id, driver_id,  load_date desc);
create index trips_pending         on trips (org_id, load_date) where status = 'pending';

-- One row per fuel/AdBlue/toll stop, not one flattened total per trip — a
-- 3-day trip with two diesel fills and an AdBlue top-up is three rows here.
create table trip_expenses (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs,
  trip_id       uuid not null,
  load_date     date not null,                     -- denormalised for co-partitioning
  spent_on      date not null,
  kind          trip_expense_kind not null,
  litres        numeric(10,2),
  rate_paise    bigint,
  amount_paise  bigint not null,
  details       text,                              -- required by the API when kind = 'other'
  receipt_id    uuid,
  created_by    uuid references users,
  created_at    timestamptz not null default now(),
  check (kind <> 'other' or details is not null)
) partition by range (load_date);

create table trip_expenses_2026_09 partition of trip_expenses
  for values from ('2026-09-01') to ('2026-10-01');

create index trip_expenses_trip on trip_expenses (org_id, trip_id);

-- Any supporting file beyond the fuel receipts already linked from
-- trip_expenses — a waybill copy, a weighbridge slip.
create table trip_documents (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs,
  trip_id     uuid not null references trips,
  receipt_id  uuid not null,
  doc_type    trip_doc_type not null default 'other',
  created_by  uuid references users,
  created_at  timestamptz not null default now()
);
create index trip_documents_trip on trip_documents (org_id, trip_id);

-- ── fixed vehicle-side costs ───────────────────────────────────────────────
create table monthly_expenses (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs,
  vehicle_id    uuid not null references vehicles,
  driver_id     uuid references drivers,
  spent_on      date not null,
  category      cost_category not null,
  amount_paise  bigint not null,
  remarks       text,
  receipt_id    uuid,
  created_by    uuid references users,
  created_at    timestamptz not null default now()
);
create index monthly_expenses_month
  on monthly_expenses (org_id, spent_on desc, category);

create table receipts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs,
  storage_key  text not null,                      -- S3/GCS object key
  mime_type    text,
  ocr_json     jsonb,
  confidence   numeric(4,3),
  uploaded_by  uuid references users,
  created_at   timestamptz not null default now()
);
alter table trip_expenses    add constraint trip_expenses_receipt_fk
  foreign key (receipt_id) references receipts;
alter table trip_documents   add constraint trip_documents_receipt_fk
  foreign key (receipt_id) references receipts;
alter table monthly_expenses add constraint monthly_expenses_receipt_fk
  foreign key (receipt_id) references receipts;

create table audit_log (
  id         bigserial primary key,
  org_id     uuid not null,
  entity     text not null,
  entity_id  uuid not null,
  action     text not null,                        -- insert | update | approve | void
  diff       jsonb not null,
  actor_id   uuid references users,
  at         timestamptz not null default now()
);
create index audit_entity on audit_log (org_id, entity, entity_id, at desc);

-- ── rollup the dashboards read ─────────────────────────────────────────────
create materialized view vehicle_month as
select t.org_id,
       t.vehicle_id,
       date_trunc('month', t.load_date)::date      as month,
       count(*)                                    as trips,
       sum(coalesce(t.odo_end - t.odo_start, 0))   as km,
       sum(coalesce(t.weight_kg, 0)) / 1000.0      as tons,
       sum(t.revenue_paise)                        as revenue_paise,
       coalesce(sum(e.amount_paise), 0)            as trip_cost_paise
from trips t
left join trip_expenses e on e.trip_id = t.id and e.org_id = t.org_id
where t.status = 'approved'
group by 1, 2, 3;

create unique index vehicle_month_key on vehicle_month (org_id, vehicle_id, month);
-- refresh materialized view concurrently vehicle_month;  -- on write, or every 60s

-- ── isolation ──────────────────────────────────────────────────────────────
alter table trips             enable row level security;
alter table trip_expenses     enable row level security;
alter table trip_documents    enable row level security;
alter table monthly_expenses  enable row level security;

create policy trips_tenant on trips
  using (org_id = current_setting('app.org_id')::uuid);

create policy trips_driver_own on trips for select
  using (org_id = current_setting('app.org_id')::uuid
         and (current_setting('app.role') <> 'driver'
              or driver_id = current_setting('app.driver_id')::uuid));

-- repeat the tenant policy for every table above; set app.org_id / app.role /
-- app.driver_id per request from the verified session, never from the client body.
