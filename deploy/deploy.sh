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
echo "Deployed. Health: curl -s https://$(grep ^DOMAIN= "$ENV_FILE" | cut -d= -f2)/health"
