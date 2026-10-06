#!/usr/bin/env python3
"""Re-orders a data-only D1 export so parent tables load before their children.

D1's SQL import commits in batches, so `PRAGMA defer_foreign_keys` from the
export header doesn't survive the whole file and a child row loaded before its
parent fails with a FOREIGN KEY error. Loading in dependency order avoids that.

Only for data-only exports (`wrangler d1 export --no-schema`). A full export
also holds CREATE TABLE statements, which this script refuses rather than
silently mangling.

Usage: order-dump.py data-only.sql > ordered.sql
"""
import re
import sys

# Parents before children. A table missing from this list is loaded just
# before the audit log — add new tables here when the schema grows.
ORDER = [
    'orgs', 'branches', 'vehicles', 'drivers', 'users', 'settings', 'counters',
    'expense_categories', 'transporters', 'driver_leaves', 'vehicle_unavailability',
    'trips', 'trip_stops', 'trip_expenses', 'receipts', 'trip_documents',
    'monthly_expenses', 'monthly_expense_documents', 'fuel_entries', 'notifications',
]
LAST = ['audit_log', 'sqlite_sequence']
SKIP = {'d1_migrations', 'rate_limits'}  # rebuilt by `wrangler d1 migrations apply`

statements = []
for line in open(sys.argv[1], encoding='utf-8'):
    if line.startswith('CREATE '):
        sys.exit('This is a full export (it has CREATE statements). Re-export with --no-schema.')
    if line.startswith('INSERT INTO'):
        statements.append(line)
    elif statements and not line.startswith('PRAGMA'):
        statements[-1] += line  # a value that contained a newline

def table(stmt):
    return re.match(r'INSERT INTO "?([A-Za-z0-9_]+)"?', stmt).group(1)

def rank(stmt):
    t = table(stmt)
    if t in ORDER: return ORDER.index(t)
    if t in LAST: return len(ORDER) + 1 + LAST.index(t)
    return len(ORDER)

out = [s for s in statements if table(s) not in SKIP]
out.sort(key=rank)  # stable: keeps row order within a table
sys.stdout.write('PRAGMA defer_foreign_keys=TRUE;\n' + ''.join(out))
