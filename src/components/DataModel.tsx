import { SCHEMA_ENDPOINTS, SCHEMA_ENTITIES, SCHEMA_RELATIONS, SCHEMA_SCALING } from '../data/mockData';

const DDL = [
  {
    name: 'trips — the hot table',
    sql: `create table trips (
  id            uuid primary key,
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
  created_by    uuid references users,
  created_at    timestamptz default now()
) partition by range (load_date);

create index trips_org_veh_date
  on trips (org_id, vehicle_id, load_date desc);
create index trips_org_driver_date
  on trips (org_id, driver_id, load_date desc);
create index trips_pending
  on trips (org_id, load_date) where status = 'pending';`
  },
  {
    name: 'trip_expenses — one row per stop',
    sql: `create type trip_expense_kind as enum
  ('diesel', 'adblue', 'toll', 'other');

create table trip_expenses (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs,
  trip_id       uuid not null references trips,
  spent_on      date not null,
  kind          trip_expense_kind not null,
  litres        numeric(10,2),
  rate_paise    bigint,
  amount_paise  bigint not null,
  details       text,           -- required when kind = 'other'
  receipt_id    uuid references receipts,
  created_by    uuid references users,
  created_at    timestamptz default now(),
  check (kind <> 'other' or details is not null)
);

create index trip_expenses_trip
  on trip_expenses (org_id, trip_id, spent_on);
-- a 3-day trip with 2 diesel fills and an AdBlue
-- top-up is 3 rows here, not one flattened total`
  },
  {
    name: 'rollup — what the dashboards read',
    sql: `create materialized view vehicle_month as
select t.org_id,
       t.vehicle_id,
       date_trunc('month', t.load_date)::date as month,
       count(*)                       as trips,
       sum(t.odo_end - t.odo_start)   as km,
       sum(t.weight_kg) / 1000.0      as tons,
       sum(t.revenue_paise)           as revenue_paise,
       sum(e.amount_paise)            as trip_cost_paise
from trips t
left join trip_expenses e on e.trip_id = t.id
where t.status = 'approved'
group by 1, 2, 3;

create unique index on vehicle_month (org_id, vehicle_id, month);
-- refresh concurrently on write, or every 60s`
  },
  {
    name: "isolation — one tenant can't read another",
    sql: `alter table trips enable row level security;

create policy trips_tenant on trips
  using (org_id = current_setting('app.org_id')::uuid);

create policy trips_driver_own on trips
  for select to driver_role
  using (driver_id = current_setting('app.driver_id')::uuid);`
  }
];

export function DataModel() {
  return (
    <section>
      <div style={{ marginBottom: 18 }}>
        <div className="kicker">Postgres · one schema, three clients</div>
        <h1 style={{ fontSize: 34, letterSpacing: '-0.02em' }}>Data Model</h1>
        <p style={{ maxWidth: '70ch', color: 'var(--color-neutral-800)', lineHeight: 1.6, marginTop: 12 }}>
          Web, iOS and Android write to the same API. A trip carries its own waybill and item reference directly — no
          separate shipment or container hierarchy — and a multi-day trip's fuel, AdBlue and toll stops are each their
          own row in <strong>trip_expenses</strong>, so cost per kilometre comes from summing real stops, not one
          flattened total. Money is stored in paise as integers, every row carries <strong>org_id</strong> so the same
          schema serves any number of transport companies or fleets, and edits are append-only with an audit row.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 2, background: 'var(--color-divider)', border: '2px solid var(--color-divider)' }}>
        {SCHEMA_ENTITIES.map((e) => (
          <div key={e.name} style={{ background: 'var(--color-bg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '12px 16px', borderBottom: '2px solid var(--color-text)' }}>
              <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 15, letterSpacing: '0.02em' }}>{e.name}</span>
              <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-accent-700)' }}>{e.tag}</span>
            </div>
            {e.fields.map((f) => (
              <div key={f.n} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 16px', borderBottom: '1px solid var(--color-neutral-300)', fontSize: 13 }}>
                <span>{f.n}</span>
                <span style={{ color: 'var(--color-neutral-700)', fontVariantNumeric: 'tabular-nums' }}>{f.t}</span>
              </div>
            ))}
            <div style={{ padding: '10px 16px 14px', fontSize: 12, color: 'var(--color-neutral-700)', lineHeight: 1.5 }}>{e.note}</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 20, margin: '28px 0 12px' }}>Relationships</h2>
      <div style={{ border: '2px solid var(--color-divider)' }}>
        {SCHEMA_RELATIONS.map((r) => (
          <div key={r} style={{ padding: '11px 16px', borderBottom: '1px solid var(--color-neutral-300)', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{r}</div>
        ))}
      </div>

      <h2 style={{ fontSize: 20, margin: '28px 0 12px' }}>Schema, as written</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 2, background: 'var(--color-divider)', border: '2px solid var(--color-divider)' }}>
        {DDL.map((d) => (
          <div key={d.name} style={{ background: 'var(--color-bg)' }}>
            <div style={{ padding: '12px 16px', borderBottom: '2px solid var(--color-text)', fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 14 }}>{d.name}</div>
            <pre style={{ margin: 0, padding: 16, overflowX: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.65, color: 'var(--color-neutral-900)', whiteSpace: 'pre' }}>{d.sql}</pre>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 20, margin: '28px 0 12px' }}>How the clients fetch</h2>
      <div style={{ border: '2px solid var(--color-divider)' }}>
        {SCHEMA_ENDPOINTS.map((e) => (
          <div key={e.method + e.path} style={{ display: 'grid', gridTemplateColumns: '70px minmax(0,1.1fr) minmax(0,1.6fr)', gap: 16, padding: '12px 16px', borderBottom: '1px solid var(--color-neutral-300)', alignItems: 'baseline' }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-accent-700)' }}>{e.method}</span>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{e.path}</span>
            <span style={{ color: 'var(--color-neutral-700)', lineHeight: 1.5 }}>{e.desc}</span>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 20, margin: '28px 0 12px' }}>Scaling</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 2, background: 'var(--color-divider)', border: '2px solid var(--color-divider)' }}>
        {SCHEMA_SCALING.map((s) => (
          <div key={s.label} style={{ background: 'var(--color-bg)', padding: 18 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-accent-700)', marginBottom: 8 }}>{s.label}</div>
            <div style={{ lineHeight: 1.6, color: 'var(--color-neutral-800)' }}>{s.body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
