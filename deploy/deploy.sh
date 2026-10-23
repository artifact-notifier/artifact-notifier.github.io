#!/usr/bin/env bash
# Deploys a backend image tag on the server: backup the SQLite file, pull, restart, check.
# Usage (on the server, from /opt/artifact-notifier): ./deploy.sh [tag]   (default: latest)
set -euo pipefail
cd "$(dirname "$0")"

TAG="${1:-latest}"
DB=data/artifact-notifier.db

if [ -f "$DB" ]; then
  mkdir -p backups
  BACKUP="backups/artifact-notifier.db.$(date +%Y%m%d-%H%M%S)"
  sqlite3 "$DB" ".backup $BACKUP"
  echo "Backup: $BACKUP"
  # keep the 20 most recent backups
  ls -1t backups/artifact-notifier.db.* | tail -n +21 | xargs -r rm --
fi

export TAG
docker compose pull backend
docker compose up -d backend

for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/preferences/constraints || true)
  # 401 = up (endpoint requires auth)
  if [ "$code" = "401" ] || [ "$code" = "200" ]; then
    echo "Backend up (tag $TAG, HTTP $code)"
    docker compose images backend
    exit 0
  fi
  sleep 2
done

echo "Backend not responding after 60s" >&2
docker compose logs --tail 50 backend >&2
exit 1
