#!/usr/bin/env bash
# Downloads one nightly backup from R2 into a local folder.
#   scripts/download-backup.sh 2026-10-04 ~/FleetLedger-backups/2026-10-04
# Run from the worker/ folder after `wrangler login`. The folder will hold real
# company data (including password hashes) — keep it out of git and private.
set -euo pipefail
DATE="${1:?backup date, e.g. 2026-10-04}"
OUT="${2:?output folder}"
BUCKET="fleet-ledger-demo-docs"
mkdir -p "$OUT"
chmod 700 "$OUT"
npx wrangler r2 object get "$BUCKET/backups/$DATE/manifest.json" --remote --file "$OUT/manifest.json"
for table in $(node -e "console.log(require('$OUT/manifest.json').order.join(' '))"); do
  npx wrangler r2 object get "$BUCKET/backups/$DATE/$table.ndjson.gz" --remote --file "$OUT/$table.ndjson.gz"
done
npx wrangler r2 object get "$BUCKET/backups/$DATE/schema.sql" --remote --file "$OUT/schema.sql"
echo "Downloaded to $OUT"
