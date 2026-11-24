#!/usr/bin/env bash
# Nightly backup of this environment's MongoDB database into its private S3 backups bucket.
# Run by dreambuilder-backup.timer every night at 02:30 Pakistan time. By hand:
#   sudo /opt/dreambuilder/backup.sh
# The bucket deletes copies older than 14 days by itself. To restore, see restore.sh.
set -euo pipefail

APP_DIR=/opt/dreambuilder
ENV_NAME="$(sed -n 's/^DEPLOY_ENV=//p' "$APP_DIR/.env")"
REGION="$(sed -n 's/^AWS_REGION=//p' "$APP_DIR/.env")"
REGION="${REGION:-ap-south-1}"
TOOLS_IMAGE="${TOOLS_IMAGE:-mongo:8.0}"   # has mongodump; matches the Atlas cluster version

# Settings come from Parameter Store with the server's own role, like deploy.sh
param() { aws ssm get-parameter --region "$REGION" --name "/dreambuilder/$ENV_NAME/$1" "${@:2}" \
  --query Parameter.Value --output text; }
BUCKET="$(param S3_BACKUP_BUCKET)"
MONGODB_URI="$(param MONGODB_URI --with-decryption)"
export MONGODB_URI   # reaches the container through its environment, never a command line

tmp="$(mktemp /var/tmp/dreambuilder-backup.XXXXXX)"
trap 'rm -f "$tmp"' EXIT

docker pull -q "$TOOLS_IMAGE" >/dev/null
docker run --rm -e MONGODB_URI "$TOOLS_IMAGE" \
  sh -c 'exec mongodump --uri="$MONGODB_URI" --archive --gzip --quiet' > "$tmp"

size="$(stat -c %s "$tmp")"
[ "$size" -gt 0 ] || { echo "Backup failed: mongodump produced nothing" >&2; exit 1; }

key="mongodb/$(date -u +%Y/%m/%d)/$ENV_NAME-$(date -u +%Y%m%dT%H%M%SZ).archive.gz"
aws s3 cp "$tmp" "s3://$BUCKET/$key" --region "$REGION" --only-show-errors
echo "Backup ok: s3://$BUCKET/$key ($size bytes)"
