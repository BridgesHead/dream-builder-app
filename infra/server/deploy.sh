#!/usr/bin/env bash
# Deploys one API image tag (API + worker) and rolls back if the API does not become healthy.
# Called by .github/workflows/deploy-api.yml through SSM:  /opt/dreambuilder/deploy.sh <image-tag>
# Can also be run by hand:             sudo /opt/dreambuilder/deploy.sh <image-tag>
# After changing a setting in Parameter Store, re-run it with the current tag to apply it:
#                                      sudo /opt/dreambuilder/deploy.sh "$(sed -n 's/^IMAGE_TAG=//p' /opt/dreambuilder/.env)"
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

TAG="${1:?usage: deploy.sh <image-tag>}"
if [[ ! "$TAG" =~ ^[A-Za-z0-9._-]{1,128}$ ]]; then
  echo "Refusing odd-looking image tag: $TAG" >&2
  exit 2
fi

# One deploy at a time
exec 9>/var/lock/dreambuilder-deploy.lock
flock -n 9 || { echo "Another deploy is already running" >&2; exit 3; }

PREV_TAG="$(sed -n 's/^IMAGE_TAG=//p' .env | tail -n1)"
set_tag() { sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=$1|" .env; }

backend_health() {
  local id
  id="$(docker compose ps -q api 2>/dev/null || true)"
  [ -n "$id" ] || { echo missing; return; }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$id" 2>/dev/null || echo missing
}

# Settings and secrets come from Parameter Store (/dreambuilder/<env>/), read with the
# server's own role, which can only read its own environment's path. Every parameter
# becomes one line of app.env: its last path part is the variable name.
RENDER_SETTINGS=$(cat <<'PY'
import json, re, sys
try:
    params = json.load(sys.stdin).get("Parameters", [])
except ValueError:
    sys.exit("Parameter Store gave no answer")
if not params:
    sys.exit("no settings found in Parameter Store")
lines = []
for p in params:
    name = p["Name"].rsplit("/", 1)[-1]
    value = p["Value"]
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*", name):
        sys.exit(f"{p['Name']}: not a valid variable name")
    if "\n" in value or "'" in value:
        sys.exit(f"{name}: values may not contain a newline or a single quote")
    lines.append(f"{name}='{value}'")   # single quotes: Compose takes the value literally
print("\n".join(sorted(lines)))
PY
)
render_settings() {
  local env region tmp site
  env="$(sed -n 's/^DEPLOY_ENV=//p' .env)"
  region="$(sed -n 's/^AWS_REGION=//p' .env)"
  tmp="$(mktemp "$APP_DIR/.app.env.XXXXXX")"
  if ! aws ssm get-parameters-by-path --region "${region:-ap-south-1}" --path "/dreambuilder/$env/" \
        --recursive --with-decryption --output json | python3 -c "$RENDER_SETTINGS" > "$tmp"; then
    rm -f "$tmp"
    echo "Could not read the $env settings from Parameter Store; nothing was changed" >&2
    return 1
  fi
  chmod 600 "$tmp"
  mv "$tmp" app.env
  # Caddy's HTTPS name is also a setting; Compose reads it from .env
  site="$(sed -n "s/^SITE_ADDRESS='\(.*\)'$/\1/p" app.env)"
  if [ -n "$site" ]; then
    if grep -q '^SITE_ADDRESS=' .env; then sed -i "s|^SITE_ADDRESS=.*|SITE_ADDRESS=$site|" .env
    else echo "SITE_ADDRESS=$site" >> .env; fi
  fi
  echo "Settings: $(grep -c . app.env) values from /dreambuilder/$env/"
}

echo "Deploying $TAG (previous: ${PREV_TAG:-none})"
render_settings

# Pull first; .env is only changed once the image is actually here. Tags are commit SHAs,
# so an image already on this server (a redeploy to apply settings) is not pulled again.
ECR_REPO="$(sed -n 's/^ECR_REPO=//p' .env)"
if docker image inspect "$ECR_REPO:$TAG" >/dev/null 2>&1; then
  echo "Image $TAG is already on this server"
else
  IMAGE_TAG="$TAG" docker compose pull api worker
fi
set_tag "$TAG"
docker compose up -d --remove-orphans

for _ in $(seq 1 36); do   # up to 3 minutes
  status="$(backend_health)"
  case "$status" in
    healthy|no-healthcheck)
      echo "Deployed $TAG ($status)"
      docker image prune -f >/dev/null || true
      exit 0 ;;
    unhealthy)
      break ;;
  esac
  sleep 5
done

echo "API did not become healthy on $TAG (last status: $status)" >&2
docker compose logs --tail=50 api worker >&2 || true

if [ -n "$PREV_TAG" ] && [ "$PREV_TAG" != "$TAG" ] && [ "$PREV_TAG" != "none" ]; then
  echo "Rolling back to $PREV_TAG" >&2
  set_tag "$PREV_TAG"
  docker compose up -d --remove-orphans
fi
exit 1
