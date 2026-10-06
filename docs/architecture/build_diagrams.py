#!/usr/bin/env python3
"""Generates the architecture diagrams (SVG). Run: python3 build_diagrams.py
Then render PNGs with Chrome headless (see README in this folder)."""
from xml.sax.saxutils import escape

INK = '#201e1d'; MUTED = '#605d5d'; LINE = '#8a8785'; ACCENT = '#EC3013'
F_CF = '#fdf0e6'; S_CF = '#e8873d'      # Cloudflare orange
F_CL = '#e8f0fb'; S_CL = '#4a7bc8'      # clients blue
F_US = '#eef6ec'; S_US = '#5a9a50'      # users green
F_EX = '#f3ecf8'; S_EX = '#8a5cb0'      # external purple
F_DB = '#fff6d6'; S_DB = '#c9a227'      # data yellow
F_SEC = '#fdeaea'; S_SEC = '#c0392b'    # security red
F_GR = '#f1f1f0'; S_GR = '#9a9896'

class Svg:
    def __init__(self, w, h, title):
        self.w, self.h = w, h
        self.o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" font-family="Helvetica, Arial, sans-serif">',
                  '<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="%s"/></marker></defs>' % LINE,
                  f'<rect width="{w}" height="{h}" fill="#ffffff"/>',
                  f'<text x="30" y="40" font-size="24" font-weight="700" fill="{INK}">{escape(title)}</text>',
                  f'<rect x="30" y="50" width="70" height="4" fill="{ACCENT}"/>']
    def box(self, x, y, w, h, fill, stroke, title=None, lines=(), tsize=14, lsize=12, rx=8, dash=False, tcolor=INK, align='left'):
        d = ' stroke-dasharray="6,4"' if dash else ''
        self.o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="1.6"{d}/>')
        cy = y + 22
        anchor = 'start'; tx = x + 12
        if align == 'center': anchor = 'middle'; tx = x + w / 2
        if title:
            self.o.append(f'<text x="{tx}" y="{cy}" font-size="{tsize}" font-weight="700" fill="{tcolor}" text-anchor="{anchor}">{escape(title)}</text>')
            cy += 8
        for ln in lines:
            cy += lsize + 5
            self.o.append(f'<text x="{tx}" y="{cy}" font-size="{lsize}" fill="{MUTED if not ln.startswith("!") else INK}" text-anchor="{anchor}">{escape(ln.lstrip("!"))}</text>')
    def label(self, x, y, text, size=12, color=MUTED, anchor='start', bold=False):
        w = ' font-weight="700"' if bold else ''
        self.o.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" text-anchor="{anchor}"{w}>{escape(text)}</text>')
    def arrow(self, x1, y1, x2, y2, label=None, lx=None, ly=None, both=False, dash=False, color=LINE):
        d = ' stroke-dasharray="6,4"' if dash else ''
        ms = ' marker-start="url(#a)"' if both else ''
        self.o.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="1.8"{d} marker-end="url(#a)"{ms}/>')
        if label:
            self.label(lx if lx is not None else (x1 + x2) / 2, ly if ly is not None else (y1 + y2) / 2 - 6, label, 11, MUTED, 'middle')
    def poly(self, pts, label=None, lx=0, ly=0, dash=False):
        d = ' stroke-dasharray="6,4"' if dash else ''
        p = ' '.join(f'{x},{y}' for x, y in pts)
        self.o.append(f'<polyline points="{p}" fill="none" stroke="{LINE}" stroke-width="1.8"{d} marker-end="url(#a)"/>')
        if label: self.label(lx, ly, label, 11, MUTED, 'middle')
    def save(self, name):
        open(name, 'w').write('\n'.join(self.o + ['</svg>']))

# ───────────────────────── 1. System architecture ─────────────────────────
s = Svg(1560, 980, 'Fleet Ledger — System architecture')
s.label(30, 72, 'Goods-movement and expense log for Demo Logistics (Fleet Ledger Demo) · all components run on Cloudflare except the source code (GitHub) and the bill reader (Google Gemini)', 12)

# users
s.box(30, 100, 250, 520, F_US, S_US, 'People (4 roles)', [], 15)
roles = [('Driver', 'Own trips, fuel, trip log'), ('Office (Documentation)', 'Movements, fuel, expenses, summary'),
         ('Manager', 'Everything: users, Master, reports'), ('Viewer', 'Read-only reports')]
for i, (r, d) in enumerate(roles):
    s.box(46, 140 + i * 115, 218, 98, '#ffffff', S_US, r, [d], 14, 12, 6)

# clients
s.box(340, 100, 330, 520, F_CL, S_CL, 'Clients (one codebase)', [], 15)
s.box(356, 140, 298, 140, '#ffffff', S_CL, 'Web app (React + TypeScript + Vite)', ['Single-page app, tabs by role', 'smkrmuthu.github.io/FleetAppDemo', 'fleet.oneuptech.co (Cloudflare)', 'Sign-in token kept in browser storage'], 13, 12, 6)
s.box(356, 296, 298, 130, '#ffffff', S_CL, 'Installed web app (PWA)', ['Add to Home Screen', 'Service worker: network-first,', 'so a new deploy is never hidden'], 13, 12, 6)
s.box(356, 442, 298, 160, '#ffffff', S_CL, 'Android app (Capacitor)', ['Same web bundle in a native shell', 'App id com.smkrmuthu.fleetledgerdemo', 'Debug build today; no Play Store', 'or iPhone app yet'], 13, 12, 6)

# cloudflare container
s.box(740, 100, 520, 850, F_CF, S_CF, 'Cloudflare account', [], 15)
s.box(756, 136, 488, 438, '#ffffff', S_CF, 'Worker  fleet-ledger-demo-api   (Hono · TypeScript)', [], 14, 12, 6)
s.box(772, 176, 456, 96, F_SEC, S_SEC, 'Middleware (every request)', ['CORS allowlist  →  verify JWT (HS256, 12 h)', '→ look up the user in the database (exists, not disabled,', 'role from DB)  →  Viewer read-only rule  →  role check'], 13, 12, 6)
s.box(772, 284, 456, 150, F_GR, S_GR, 'Routes  /v1/…', ['!auth · trips · monthly-expenses · vehicles · drivers', '!users · settings · transporters · expense-categories', '!driver-leaves · vehicle-unavailability', '!notifications · receipts (bill scan) · admin (backups)', 'org_id always taken from the token, never the request'], 13, 12, 6)
s.box(772, 446, 220, 112, F_GR, S_GR, 'Libraries', ['!password (PBKDF2) · jwt', '!rate limiter (D1)', '!file checks (magic bytes)', '!audit log · backup job'], 13, 12, 6)
s.box(1008, 446, 220, 112, F_SEC, S_SEC, 'Scheduled job (cron)', ['!21:00 UTC = 02:30 IST', 'Nightly backup, 30 nights', 'Cleans expired rate limits'], 13, 12, 6)
s.box(756, 604, 236, 176, F_DB, S_DB, 'D1 database (SQLite)', ['!fleet-ledger-demo-db · 22 tables', 'Trips, expenses, vehicles,', 'drivers, users, settings,', 'audit log, rate limits …', 'Time Travel: 7 / 30 days', 'Versioned migrations'], 13, 12, 6)
s.box(1008, 604, 236, 176, F_DB, S_DB, 'R2 bucket', ['!fleet-ledger-demo-docs', 'Uploaded bills & photos', '(<org>/<trip>/<file>)', 'backups/<date>/ …', 'backups/files/ (copies)'], 13, 12, 6)
s.box(756, 800, 488, 130, '#ffffff', S_CF, 'Worker configuration', ['!Bindings: DB (D1) · DOCS (R2)', '!Secrets: JWT_SECRET · GEMINI_API_KEY (never in code or backups)', '!Variable: ALLOWED_ORIGIN (the sites allowed to call the API)', 'Static site: the web app is also served by a Cloudflare Worker', '(fleetappdemo) behind the domain fleet.oneuptech.co'], 13, 12, 6)

# external
s.box(1320, 100, 210, 150, F_EX, S_EX, 'Google Gemini API', ['Reads a fuel-bill photo', '(litres, rate, amount, date)', 'Called only from the Worker', 'Key is a Worker secret'], 13, 12, 6)
s.box(1320, 290, 210, 190, F_EX, S_EX, 'GitHub', ['smkrmuthu/FleetAppDemo', 'Actions: type-check, tests,', 'build · Pages hosting', 'Dependabot weekly updates'], 13, 12, 6)
s.box(1320, 520, 210, 130, F_EX, S_EX, 'Cloudflare Git build', ['Rebuilds the web app on', 'fleet.oneuptech.co when', 'main changes'], 13, 12, 6)

# arrows
s.arrow(280, 190, 340, 190, 'use', 310, 180)
s.arrow(280, 305, 340, 305)
s.arrow(280, 420, 340, 420)
s.arrow(280, 535, 340, 535)
s.arrow(670, 280, 740, 280, 'HTTPS + Bearer token', 705, 262, both=True)
s.arrow(874, 574, 874, 604, 'queries', 900, 592, both=True)
s.arrow(1126, 574, 1126, 604, 'files', 1150, 592, both=True)
s.arrow(1244, 330, 1320, 175, 'bill photo', 1290, 235)
s.arrow(1425, 480, 1425, 520, 'main changes', 1425, 504, dash=True)
s.arrow(1320, 585, 1260, 585, 'serves site', 1290, 578, dash=True)
s.save('01-system-architecture.svg')

# ───────────────────────── 2. Request pipeline & security ─────────────────────────
s = Svg(1560, 760, 'Fleet Ledger — What happens to every request (security layers)')
s.label(30, 72, 'Every call to the API passes the same gates, in this order. A failure at any gate stops the request and returns an error; nothing reaches the database.', 12)
steps = [
 ('1  CORS', ['Only the listed websites', 'and the mobile app origin', 'may call the API'], F_GR, S_GR, 'blocked by browser'),
 ('2  Verify token', ['Signed token (HS256)', 'valid for 12 hours', 'signed with JWT_SECRET'], F_SEC, S_SEC, '401 invalid / expired'),
 ('3  Check the account', ['Look the user up in D1:', 'exists · not disabled ·', 'same company · role from DB'], F_SEC, S_SEC, '401 account no longer active'),
 ('4  Viewer rule', ['Viewer: GET only,', 'no bills, no notifications'], F_SEC, S_SEC, '403 read-only'),
 ('5  Role check', ['requireRole on the route,', 'e.g. Office / Manager for', 'writes, Manager for users'], F_SEC, S_SEC, '403 not allowed'),
 ('6  Handler', ['Validate input (zod) ·', 'apply business rules ·', 'scope to the token’s company'], F_CF, S_CF, '404 / 409 / 422'),
 ('7  Database / files', ['D1 read or write ·', 'R2 file store ·', 'audit_log entry on change'], F_DB, S_DB, '500 generic message'),
]
bw, gap, x0, y0 = 188, 28, 30, 110
for i, (t, ls, f, st, err) in enumerate(steps):
    x = x0 + i * (bw + gap)
    s.box(x, y0, bw, 118, f, st, t, ls, 14, 12, 8)
    s.label(x + bw / 2, y0 + 142, err, 11, S_SEC if '40' in err else MUTED, 'middle')
    if i < len(steps) - 1: s.arrow(x + bw, y0 + 59, x + bw + gap, y0 + 59)
s.label(30, 292, 'Failure responses are JSON: { "error": { "code", "message" } }. Unexpected errors return a generic message and are logged on the server only.', 12)

s.box(30, 330, 740, 168, '#ffffff', S_SEC, 'Sign-in (POST /v1/auth/password) — extra protection', [
 '1. Rate limit: 10 attempts / minute per network address and 5 / minute per account.',
 '    Counts live in the D1 table rate_limits, so they are shared by all Worker instances and survive restarts.',
 '2. Find the user by mobile number or User ID; refuse if no password or the account is disabled.',
 '3. Check the password: PBKDF2-SHA-256, 100,000 iterations, a random salt per user, constant-time compare.',
 '4. Return a 12-hour token holding only company, user id, role and driver id.',
 'The same limiter protects the bill-scan endpoint (10 / min per user, 20 / min per network).'], 14, 12, 8)
s.box(800, 330, 730, 168, '#ffffff', S_SEC, 'Uploaded files — checked before they are stored or served', [
 '• Only JPEG, PNG, WebP, HEIC/HEIF and PDF are accepted. HTML, SVG and scripts are rejected outright.',
 '• The file’s real first bytes (“magic bytes”) must match the type it claims to be.',
 '• Maximum size about 9 MB per file (12 million base64 characters).',
 '• Files are stored in R2 under <company>/<trip>/<id>__<name>; the database holds only the pointer.',
 '• Downloads are served with a safe content type and “nosniff”; a Viewer cannot download bills.'], 14, 12, 8)

s.box(30, 528, 1500, 200, F_GR, S_GR, 'Who can do what (summary — detail is in the Technical Document)', [], 14)
cols = [('Driver', ['Add and edit own open movements', 'May add "other" expenses to them', 'No fuel, no fixed costs, no revenue / profit']),
        ('Office', ['Movements, fuel, monthly expenses', 'Trucks, drivers, leave, availability', 'Cannot change approved movements']),
        ('Manager', ['Everything above, plus:', 'Users, passwords, Master, backups', 'Corrects completed movements']),
        ('Viewer', ['Dashboard, Movement Summary,', 'Monthly Report (view, export)', 'Never changes anything'])]
for i, (r, ls) in enumerate(cols):
    s.box(46 + i * 372, 568, 356, 140, '#ffffff', S_GR, r, ls, 14, 12, 6)
s.save('02-request-pipeline-security.svg')

# ───────────────────────── 3. Data model ─────────────────────────
s = Svg(1560, 1080, 'Fleet Ledger — Data model (22 tables in D1)')
s.label(30, 72, 'Every table carries org_id (the company), so one deployment can hold several companies. Money is stored as whole paise (integers); dates as ISO text. Arrows point from the child table to the table it refers to.', 12)

def tbl(x, y, w, name, cols, fill=F_GR, stroke=S_GR):
    h = 40 + 16 * len(cols)
    s.box(x, y, w, h, fill, stroke, name, [], 13, 12, 6)
    for i, c in enumerate(cols):
        s.label(x + 12, y + 44 + i * 16, c, 11, MUTED)
    return h

# company core
s.box(30, 96, 480, 284, F_US, S_US, 'Company and people', [], 14)
tbl(46, 130, 140, 'orgs', ['id · name', 'currency · fy_start_month'], '#fff', S_US)
tbl(46, 214, 140, 'branches', ['id · org_id · name'], '#fff', S_US)
tbl(46, 280, 140, 'settings', ['org_id · key · value', '(diesel rate, loading', ' point …)'], '#fff', S_US)
tbl(206, 130, 290, 'users', ['id · org_id · role (driver, office,', '   manager, viewer) · full_name', 'phone · user_id · password_hash/salt', 'driver_id · disabled_at · last_seen_at'], '#fff', S_US)
tbl(206, 260, 290, 'counters', ['org_id · key (trip_no) · value', '→ next trip number DEMO-#####'], '#fff', S_US)

# fleet
s.box(540, 96, 500, 284, F_CL, S_CL, 'Fleet master data', [], 14)
tbl(556, 130, 230, 'vehicles', ['id · org_id · reg_no (unique per org)', 'model · owner · reg_date · batch_no', 'tax / inspection(=Insurance) / np /', '  fc / pollution dates', 'default_driver · active'], '#fff', S_CL)
tbl(800, 130, 226, 'drivers', ['id · org_id · branch_id', 'full_name · phone · licence_no', 'licence_expiry · credential', 'default_vehicle · active'], '#fff', S_CL)
tbl(556, 280, 230, 'vehicle_unavailability', ['vehicle_id · starts_at · ends_at'], '#fff', S_CL)
tbl(800, 280, 226, 'driver_leaves', ['driver_id · starts_at · ends_at'], '#fff', S_CL)

# lists
s.box(1070, 96, 460, 284, F_GR, S_GR, 'Pick-lists (name is the id)', [], 14)
tbl(1086, 130, 200, 'expense_categories', ['id (= name) · org_id · active', 'e.g. Fastag, Permit, EMI'], '#fff', S_GR)
tbl(1300, 130, 214, 'transporters', ['id (= name) · org_id · active'], '#fff', S_GR)
tbl(1086, 220, 428, 'notifications', ['id · org_id · kind · message · tab', 'related_trip_id · target_user_id · read'], '#fff', S_GR)

# operations
s.box(30, 400, 1010, 412, F_CF, S_CF, 'Operations', [], 14)
tbl(46, 434, 330, 'trips', ['id · org_id · vehicle_id · driver_id', 'waybill_no (DEMO-#####) · item_no', 'load_date · unload_date · from/to + notes', 'weight_kg · odo_start · odo_end', 'revenue_paise · status (draft/pending/approved)', 'transporter · remarks · created/updated'], '#fff', S_CF)
tbl(396, 434, 300, 'trip_expenses', ['id · trip_id · spent_on · kind', '   (diesel, adblue, toll, other)', 'litres · rate_paise · amount_paise', 'details (remarks) · receipt_id'], '#fff', S_CF)
tbl(396, 568, 300, 'trip_stops', ['trip_id · seq · location · date', 'odo · note'], '#fff', S_CF)
tbl(716, 434, 308, 'monthly_expenses', ['id · vehicle_id · driver_id · spent_on', 'category (e.g. Fastag) · amount_paise', 'remarks · voided_at (soft delete)'], '#fff', S_CF)
tbl(46, 620, 330, 'trip_documents', ['trip_id · receipt_id · doc_type'], '#fff', S_CF)
tbl(46, 694, 330, 'fuel_entries', ['id · vehicle_id · spent_on · litres', 'rate_paise · amount_paise · details', '→ a fill with no trip yet; moved onto a trip', '   (as a trip_expenses line) when assigned'], '#fff', S_CF)
tbl(716, 560, 308, 'monthly_expense_documents', ['monthly_expense_id · receipt_id'], '#fff', S_CF)
tbl(396, 664, 300, 'receipts', ['id · storage_key (R2 object) · mime_type', 'ocr_json · confidence · uploaded_by'], F_DB, S_DB)

# system
s.box(1070, 400, 460, 412, F_SEC, S_SEC, 'System tables', [], 14)
tbl(1086, 434, 428, 'audit_log', ['id · org_id · entity · entity_id · action (insert,', '   update, delete, void) · diff · actor_id · at', '→ who changed what, and when'], '#fff', S_SEC)
tbl(1086, 540, 428, 'rate_limits', ['key · count · reset_at', '→ sign-in and bill-scan attempt counters (disposable)'], '#fff', S_SEC)
tbl(1086, 620, 428, 'd1_migrations', ['name · applied_at', '→ which migration files have run (0000 … 0015)'], '#fff', S_SEC)

# relations (simplified): child -> parent
s.arrow(396, 490, 376, 490, None)
s.arrow(236, 620, 236, 574, None)
s.arrow(870, 560, 870, 526, None)
s.label(30, 834, 'Main relationships: trips → vehicles, drivers · trip_expenses, trip_stops, trip_documents → trips · monthly_expenses → vehicles, drivers · documents → receipts (file pointer) · fuel_entries → vehicles · users, vehicles, drivers, trips … → orgs (company).', 12)
s.label(30, 854, 'A circular link exists on purpose: vehicles.default_driver ↔ drivers.default_vehicle. Backups record this so a restore can load it correctly.', 12)
s.label(30, 874, 'Soft deletes: monthly expenses are voided (voided_at), pick-list items are made inactive; trips and fuel lines can be deleted while open, and every change is written to audit_log.', 12)
s.box(30, 900, 1500, 140, '#ffffff', S_GR, 'Design notes', [
 '• Money in paise (integer) avoids rounding errors; litres are decimal, shown to 2 places; amounts are rounded to 2 places when posted (litres × rate).',
 '• Trip numbers come from an atomic counter row (insert … on conflict update … returning), so two people saving at once never get the same number.',
 '• Indexes cover the common screens: trips by company+vehicle+date, by company+driver+date, and pending trips; monthly expenses by month+category; expiry dates for reminders.',
 '• Deleting a company would cascade to its rows (ON DELETE CASCADE on org_id); child rows of a trip cascade when the trip is deleted.'], 14, 12, 8)
s.save('03-data-model.svg')

# ───────────────────────── 4. Deployment, CI/CD and backup ─────────────────────────
s = Svg(1560, 920, 'Fleet Ledger — Build, deploy and backup')
s.label(30, 72, 'A change moves left to right: written and tested on a branch, merged to main, published; the database and the nightly backup live in Cloudflare.', 12)

s.box(30, 100, 220, 150, F_GR, S_GR, 'Developer machine', ['Code + Claude Code', 'Branch per change', 'npx tsc · npm test', 'Local browser checks'], 14, 12, 8)
s.box(300, 100, 260, 150, F_EX, S_EX, 'GitHub  smkrmuthu/FleetAppDemo', ['!Branches → merge to main', 'CI on every push:', ' type-check · tests · build', ' (app and API, Node 22)'], 14, 12, 8)
s.box(610, 100, 270, 150, F_EX, S_EX, 'Publish the web app', ['!GitHub Pages workflow', ' type-check + tests + build,', ' deploys only if they pass', '!Cloudflare Git build (fleetappdemo)'], 14, 12, 8)
s.box(930, 100, 270, 150, F_CL, S_CL, 'Websites (same bundle)', ['smkrmuthu.github.io/FleetAppDemo', 'fleet.oneuptech.co', 'fleetappdemo.smkrmuthu.workers.dev', 'Android app built from dist/'], 14, 12, 8)
s.arrow(250, 175, 300, 175, 'push', 275, 165)
s.arrow(560, 175, 610, 175)
s.arrow(880, 175, 930, 175)

s.box(300, 300, 260, 150, F_CF, S_CF, 'Deploy the API (by hand)', ['!cd worker', '!npx wrangler deploy', 'Done before the web app', 'that needs it. Roll back with', 'npx wrangler rollback'], 14, 12, 8)
s.box(610, 300, 270, 150, F_DB, S_DB, 'Change the database', ['!npm run db:generate', '!Back up first, then', '!npm run db:migrate:remote', 'Files in worker/migrations/', 'are never edited once applied'], 14, 12, 8)
s.arrow(250, 220, 300, 350, None)
s.label(232, 300, 'wrangler', 11, MUTED, 'end')

s.box(930, 300, 600, 150, F_CF, S_CF, 'Cloudflare account (production)', ['!Worker fleet-ledger-demo-api  ·  D1 fleet-ledger-demo-db  ·  R2 fleet-ledger-demo-docs', 'Secrets set with wrangler secret put (JWT_SECRET, GEMINI_API_KEY)', 'Cron trigger: 0 21 * * *   (02:30 India time)'], 14, 12, 8)
s.arrow(880, 375, 930, 375)
s.poly([(430, 450), (430, 478), (1230, 478), (1230, 450)], 'deploy', 830, 470)

s.box(30, 500, 1500, 390, '#ffffff', S_DB, 'Backup and recovery — three layers', [], 15)
s.box(50, 540, 470, 200, F_DB, S_DB, '1 · Time Travel (automatic)', ['Cloudflare keeps the database history', '7 days (free plan) / 30 days (paid).', 'Restore the whole database to a moment:', '!wrangler d1 time-travel restore', 'Use it to undo a bad change.'], 14, 12, 8)
s.box(540, 540, 470, 200, F_CF, S_CF, '2 · Nightly backup (automatic)', ['02:30 India time the Worker copies every table', 'to R2: backups/<date>/<table>.ndjson.gz', '+ schema.sql + manifest.json (written last),', 'and new uploaded files to backups/files/.', 'Keeps 30 nights. Master → Data backup shows', 'the last run, warns if it is old or failed.', 'Table load order and circular links are in the manifest.'], 14, 12, 8)
s.box(1030, 540, 480, 200, F_GR, S_GR, '3 · Off-site copy (manual, monthly)', ['The backups share the Cloudflare account,', 'so they do not cover losing the account.', 'Download one and keep it elsewhere, encrypted:', '!scripts/download-backup.sh <date> <folder>', 'Never put it in the repository (gitignored).'], 14, 12, 8)
s.box(50, 760, 1460, 110, '#ffffff', S_GR, 'Restore from a nightly backup', ['download-backup.sh → migrations build the empty tables → restore-from-backup.mjs writes SQL (parents first, circular links filled last)', '→ wrangler d1 execute --file restore.sql → compare row counts with manifest.json → sign in and check the latest trips.  Tested end to end on a local copy, 4 Oct 2026.'], 14, 12, 8)
s.save('04-deployment-and-backup.svg')
print('ok')
