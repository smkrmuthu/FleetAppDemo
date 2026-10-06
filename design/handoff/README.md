# Handoff: Exim Ledger — container movement & expense log

> **Superseded (2026-09-14).** The product pivoted away from export/import trade
> documentation to plain domestic goods movement — no shipments, containers,
> direction, CFS/CHA/customs, just a waybill and item reference per trip, now
> renamed **Fleet Ledger**. Trips also gained multiple fuel/AdBlue/toll stops
> per trip (not one flat total), a document uploader, and a notification bell
> for pending approvals and licence/FC alerts, none of which this document
> describes. **`SCHEMA.sql` and `API.md` in this folder are kept current with
> the actual implementation — read those first.** This file (and `styles.css`,
> whose design tokens are unaffected) is kept only as a record of the original
> design intent and screen-by-screen layout the visual system was built from.

## Overview
A three-surface product (web dashboard first, then iOS and Android) for an import/export
company that runs its own trucks. Drivers and documentation staff record container
**movements** (port ↔ CFS / factory / warehouse) against a shipment (BL); documentation
and admin post **monthly / shipment expenses** (CFS, CHA, customs duty, detention, plus
vehicle fixed costs); managers read the **monthly report** and close the month.

Roles and access, as specified by the client:

| Capability | Driver | Documentation (office) | Manager / Admin |
| --- | --- | --- | --- |
| Add movement (manual or scanned receipt) | ✅ own | ✅ any driver | ✅ |
| Trip log | own rows only | all | all |
| Movement summary + filters | — | ✅ | ✅ |
| Monthly expenses (add/edit) | — | ✅ | ✅ |
| Monthly report (vehicle-wise) | — | — | ✅ |
| People (users + drivers) | — | ✅ read | ✅ manage |

Driver-entered movements land as **pending**; documentation/manager entries post as
**approved**.

## About the Design Files
The files in this bundle are **design references created in HTML** — a prototype of the
intended look and behaviour, not production code to copy. Recreate these designs in the
target codebase using its existing framework, component library and patterns. If no
codebase exists yet, pick the stack (the schema below assumes PostgreSQL; a
Next.js/React + Postgres or a Node/Nest API + React Native pair both fit) and implement
the designs there.

`Exim Ledger.dc.html` is a single-file streaming prototype. Read it for layout and copy;
do not port its runtime.

## Fidelity
**High fidelity.** Colours, type, spacing, rules and copy are final and come from the
Modernist design system (tokens listed below). Recreate pixel-faithfully using the
codebase's own components, keeping the tokens.

## Screens / Views

### 1. Sign in
- **Purpose**: authenticate by registered mobile number.
- **Layout**: full-viewport 2-column grid, `minmax(0,1fr) minmax(0,1fr)`.
  - Left: accent (#ec3013) panel, white text, padding 56px 48px, flex column with
    space-between. Wordmark top (18px/800/uppercase/0.02em), centre statement
    `clamp(34px, 4.4vw, 62px)`, weight 800, line-height 0.98, letter-spacing −0.03em,
    followed by a 2px white 60%-opacity rule (max-width 340px, margin 28px 0 20px) and a
    15px/1.6 paragraph capped at 44ch. Footer line 12px uppercase 0.1em.
  - Right: padding 56px 48px, max-width 560px, vertically centred. H1 32px/800/−0.02em,
    16px gap form grid: mobile (tel), password, "keep me signed in" checkbox row,
    full-width primary button, then a flex row with "Forgot password" / "Sign in with OTP
    instead".
  - Below a 2px top divider: a prototype account picker (remove in production).
- **Behaviour**: successful sign-in reveals the app shell; sign-out returns here and
  clears the fields.
- **Production notes**: OTP is the realistic primary for drivers; keep password for
  office/manager. Session should persist on device (drivers re-open all day).

### 2. App shell
- **Header** (padding 14px 24px, 2px bottom divider, flex space-between, wraps):
  wordmark "EXIM LEDGER" 20px/800/−0.02em uppercase + 11px/0.14em uppercase subtitle in
  neutral-700. Right: role switcher (prototype only — replace with the real session
  role), user name (600) over org line (11px uppercase neutral-700), ghost "Sign out".
- **Tab bar**: horizontal scroll, 2px bottom divider, padding 0 12px. Tab buttons
  13px/600/uppercase/0.04em, neutral-700, padding 14px 14px 12px; the active tab has a
  4px accent bar pinned to the bottom edge (left/right inset 14px, bottom −2px) and
  hover raises the label to --color-text. **Tabs are filtered by role** per the table above.
- **Main**: padding 24px, max-width 1680px.
- **Footer**: 2px top divider, padding 16px 24px, 12px neutral-700, role note right.

### 3. Movement Summary
- Page head: 11px/0.16em uppercase accent-700 kicker, H1 34px/800/−0.02em, right-aligned
  "Export Excel" (secondary) + "Print / Save PDF" (primary).
- **Filters** block: 2px divider border, padding 16px; grid
  `repeat(auto-fit, minmax(190px,1fr))`, gap 14px, items end-aligned — date from, date to,
  vehicle select, driver text, ghost "Reset filters" (`justify-self:start`).
- **Stat grid**: `repeat(auto-fit, minmax(180px,1fr))`, gap 2px on a divider background
  inside a 2px border — the gap *is* the rule. Each cell: 11px/0.12em uppercase label,
  28px/800 value, 12px neutral-700 note. Nine stats: Movements, Vehicles, Total km,
  Total tons, Trip expense, Shipment costs, Avg ₹/km, Revenue, Profit.
- **Vehicle-wise table** (`.table`, min-width 940px, horizontal scroll inside a 2px border):
  Vehicle, Model, Trips, KM, Tons, Trip expense, Monthly expense, Revenue, Profit, ₹/km.
  Numerics right-aligned; profit coloured (see tokens).

### 4. Add Movement
- 2-column grid `minmax(0,2.2fr) minmax(0,1fr)`, gap 2px on divider bg inside 2px border.
- **Left — form**: grid `repeat(auto-fit, minmax(190px,1fr))`, gap 14px. Fields:
  Loading date, Unloading date, Vehicle* (select), Driver* (text), Direction* (Import/
  Export), Shipment / BL no*, Container no, Loading location, Unloading location,
  Loading weight (tons), Odometer start, Odometer end, Diesel litres, Diesel price/litre
  (default 95), Toll, Other expense, Revenue, Remarks (spans 2).
  Action row: primary "Add movement", secondary "Clear", ghost "Save draft".
  Below a 2px rule, a live readout (22px/800): Distance (odo end − start), Trip expense
  (litres × price + toll + other), Profit (revenue − expense, green/red), Mileage (km/l).
- **Right — receipt rail**: 2px **dashed** divider box, 26px 18px padding, 17px/800 title,
  neutral-700 body, secondary "Scan receipt". On scan, a parsed panel appears: 2px solid
  ink border, ink header bar (bg --color-text, bg-coloured text, 11px/0.12em uppercase,
  padding 8px 12px), rows of label/value split by a 1px neutral-300 rule, then a
  full-width primary "Fill the form". Footer note explains the pending rule.
- **Validation**: vehicle and driver required; BL required in production. Odometer end ≥
  start. Amounts ≥ 0. Duplicate container+date should warn, not block.

### 5. Trip Log
- Head kicker shows the filtered count. Actions: "Export Excel", "Backup data",
  primary "Add movement".
- Same filters block as the summary.
- Table (min-width 1560px): Gated (load → unload), Dir (IMP `.tag.tag-neutral` /
  EXP `.tag.tag-outline`), Shipment / BL (mono 12px), Container (mono 12px neutral-700),
  Vehicle (600), Driver, Route (neutral-700), Tons, KM, Diesel, Toll, Other, Expense,
  Revenue, Profit (coloured, 700), Status (Pending = `.tag.tag-accent`, Approved =
  `.tag.tag-outline`).
- Drivers see only their own rows (enforced server-side).

### 6. Monthly Expenses
- Add-expense block: 2px border, padding 20px, grid `repeat(auto-fit, minmax(190px,1fr))`,
  gap 14px — Date, Vehicle, Driver, Description (select), Amount, Remarks, primary
  "Add expense" (`justify-self:start`).
  Categories: CFS / port charges, Customs duty, CHA fee, Detention / demurrage,
  Maintenance, Insurance, Tyres, Permit / tax, Loan / lease, Fine, Other.
- Category totals: `repeat(auto-fit, minmax(170px,1fr))` cells, each a 6px full-height
  tint block + label + 22px/800 total.
- Log table (min-width 860px): Date, Vehicle, Driver, Description (4×15px tint chip
  before the label), Remarks, Amount.

### 7. Monthly Report (manager only)
- Headline grid `repeat(auto-fit, minmax(260px,1fr))`: Revenue, Total cost, Profit,
  Cost / ton — 34px/800 values.
- Cost-per-km bar list: rows of `150px minmax(0,1fr) 90px`, gap 14px, 9px vertical
  padding, 1px neutral-300 bottom rule. Track 18px tall neutral-200; fill accent, width
  proportional to the max.
- Vehicle-wise ledger table (min-width 1100px): Vehicle, Trips, KM, Tons, Diesel, Toll,
  Other, Monthly, Total cost, Revenue, Profit, Margin %.

### 8. People
- Head: count kicker, H1, "Add driver" (secondary) + "Invite user" (primary).
- **User accounts** table (min-width 1000px): Name, Role (Manager = `.tag.tag-accent`,
  others `.tag.tag-outline`), Mobile (mono), Branch, Can see, Last active.
- **Drivers** table (min-width 1120px): Driver, Licence no (mono), Expiry (accent tag
  when inside 60 days), Assigned vehicle, Credential, Movements, Pending, KM, ₹/km,
  Revenue.
- Note: nightly job flags licences expiring within 60 days and notifies the manager.

### 9. Data Model (reference screen)
Renders the schema, relationships, DDL, endpoints and scaling notes — see
`SCHEMA.sql` and `API.md` in this bundle, which are the authoritative copies.

## Interactions & Behavior
- Tab and role changes are instant, no transition; the active-tab bar is the only
  indicator.
- Filters apply live (no Apply button); "Reset filters" clears vehicle + driver.
- "Add movement" validates, prepends the row to the log, clears the form and navigates
  to the Trip Log.
- "Scan receipt" → parsed-fields panel → "Fill the form" writes vehicle, litres, rate and
  date into the form, leaving the user to confirm and save. Production: upload to object
  storage via a signed URL, queue OCR, poll or subscribe for the parsed result; show a
  spinner state in the rail and a low-confidence warning below 0.8.
- Hover: buttons take the design system's accent tint; tab labels darken; prototype
  account rows tint accent-100.
- Focus: `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px }`
  — never the browser default.
- Responsive: every grid is `auto-fit/minmax`, so the same markup collapses to one column.
  Tables scroll horizontally inside their bordered container rather than reflowing.
- Empty states: "No movements match the selected filters." in neutral-700, same padding
  as a row.

## State Management
Prototype state (map to your store / server state as appropriate):
- `authed`, `auth {phone, pass}` — session.
- `role` (Driver | Office | Manager) — **from the session in production**, never client-set.
- `tab` — current screen; default is the first tab allowed for the role.
- `trips[]`, `expenses[]` — server data; paginate by keyset, don't hold the month in memory.
- `vehicleFilter`, `driverFilter`, date range — belong in the URL query so views are shareable.
- `form{}` (18 fields), `exp{}` (6 fields) — local form state.
- `scanned` — receipt OCR result present.
Derived, never stored: km, diesel cost, trip expense, profit, ₹/km, ₹/ton, margin,
category totals, per-vehicle and per-driver aggregates.

## Design Tokens
From the Modernist design system (`styles.css` is bundled; link it or port the values).

Colour
- Ground `--color-bg` #f3f2f2 · Surface `--color-surface` #eae9e9 · Ink `--color-text` #201e1d
- Accent `--color-accent` #ec3013 · Divider `--color-divider` = ink at 40%
- Accent ramp 100→900: #fff2ef #ffe0d9 #ffc4b8 #ff9783 #ff563c #dd2b0f #ae1800 #7c1405 #4d170e
- Neutral ramp 100→900: #f8f4f4 #eae7e7 #d7d3d3 #bab6b6 #9b9797 #7d7979 #605d5d #444141 #2d2b2b
- **Added for this product**: `--color-profit: oklch(0.46 0.10 152)` — positive money only.
  Negative money uses `--color-accent-700` (#ae1800) so it stays readable at body size.
- Category tints (6px block / 4px chip): CFS accent-700 · Customs duty neutral-900 ·
  CHA fee neutral-600 · Detention accent · Maintenance neutral-500 · Insurance neutral-800 ·
  Tyres accent-300 · Permit neutral-300 · Loan accent-400 · Fine accent-600.

Type — Archivo throughout (400/500/600/800).
- Page H1 34px/800/−0.02em · Section H2 20px/800 · Stat value 28px/800 · Report headline
  34px/800 · Body 14px · Kicker & table-adjacent labels 11px uppercase, 0.12–0.16em
  tracking · Mono columns (BL, container, licence, phone) `ui-monospace` 12–13px.

Spacing — `--space-1..8` = 4 / 8 / 12 / 16 / 24 / 32px. Page padding 24px, card padding
16–20px, form gap 14px, section rhythm 28px.

Radius — **0 everywhere**. Shadows — none in this product; rules do the work.
Rules — 2px `--color-divider` between sections and around blocks; 1px
`--color-neutral-300` between rows inside a block; grid gaps of 2px on a divider
background create the internal rules.

## Assets
No images. Icons: Lucide (https://lucide.dev) if you add any — the prototype ships none.
Font: Archivo via Google Fonts (400;500;600;800).

## Files
- `Exim Ledger.dc.html` — the full interactive prototype (all nine views).
- `SCHEMA.sql` — PostgreSQL schema: tables, partitions, indexes, rollup, RLS.
- `API.md` — endpoint contract, auth, pagination, offline/idempotency rules.
- `styles.css` — the Modernist token sheet and component layer.
