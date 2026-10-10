#!/usr/bin/env bash
# Build and (re)start the production stack on the server. Run from the repo root
# on the EC2 host:   bash deploy/deploy.sh
# First run: creates deploy/prod.env from the example and stops so you can edit it.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=deploy/prod.env
if [ ! -f "$ENV_FILE" ]; then
  cp deploy/prod.env.example "$ENV_FILE"
  sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" "$ENV_FILE"
  echo "Created $ENV_FILE with a random database password. Check DOMAIN, then re-run this script."
  exit 0
fi

git pull --ff-only
docker compose --env-file "$ENV_FILE" -f deploy/docker-compose.prod.yml up -d --build
docker compose --env-file "$ENV_FILE" -f deploy/docker-compose.prod.yml run --rm db-init
docker compose --env-file "$ENV_FILE" -f deploy/docker-compose.prod.yml ps

# Nightly database dump at 03:15 UTC (see deploy/backup.sh). Replaces any
# earlier entry, so re-running this script never adds a second one.
mkdir -p deploy/backups
BACKUP_JOB="15 3 * * * cd $(pwd) && bash deploy/backup.sh >> deploy/backups/backup.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'deploy/backup.sh' || true; echo "$BACKUP_JOB" ) | crontab -
echo "Deployed. Health: curl -s https://$(grep ^DOMAIN= "$ENV_FILE" | cut -d= -f2)/health"
