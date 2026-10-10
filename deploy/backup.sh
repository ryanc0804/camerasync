#!/usr/bin/env bash
# Nightly database backup on the production host. deploy.sh installs a cron
# entry that runs this at 3:15 every morning (server time, UTC):
#
#   bash deploy/backup.sh
#
# Writes a compressed pg_dump to deploy/backups/ and keeps the newest 7. The
# folder lives on the instance's disk, which provision-snapshots.sh snapshots
# daily, so each dump also ends up off the instance.
#
# Restore one into the running database (replaces what is there):
#   gunzip -c deploy/backups/<file>.sql.gz | docker compose --env-file deploy/prod.env \
#     -f deploy/docker-compose.prod.yml exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=deploy/prod.env
BACKUP_DIR=deploy/backups
KEEP=7

mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/camerasync-$(date -u +%Y-%m-%d-%H%M).sql.gz"
trap 'rm -f "$file.tmp"' EXIT

# --clean so a restore replaces existing tables instead of failing on them.
docker compose --env-file "$ENV_FILE" -f deploy/docker-compose.prod.yml exec -T db \
  sh -c 'pg_dump --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | gzip > "$file.tmp"
mv "$file.tmp" "$file"

ls -1t "$BACKUP_DIR"/camerasync-*.sql.gz | tail -n +$((KEEP + 1)) | xargs -r rm --
echo "Backed up to $file"
