#!/usr/bin/env bash
# Restores a database backup made by backup.sh. On the server:
#   sudo /opt/dreambuilder/restore.sh list              # backups in S3, newest last
#   sudo /opt/dreambuilder/restore.sh test [KEY]        # restore into <db>_restore_test, compare, clean up
#   sudo /opt/dreambuilder/restore.sh restore KEY --yes # REPLACE the live database with backup KEY
# KEY defaults to the newest backup. "test" never touches the live database.
set -euo pipefail

APP_DIR=/opt/dreambuilder
ENV_NAME="$(sed -n 's/^DEPLOY_ENV=//p' "$APP_DIR/.env")"
REGION="$(sed -n 's/^AWS_REGION=//p' "$APP_DIR/.env")"
REGION="${REGION:-ap-south-1}"
TOOLS_IMAGE="${TOOLS_IMAGE:-mongo:8.0}"

param() { aws ssm get-parameter --region "$REGION" --name "/dreambuilder/$ENV_NAME/$1" "${@:2}" \
  --query Parameter.Value --output text; }
BUCKET="$(param S3_BACKUP_BUCKET)"
MONGODB_URI="$(param MONGODB_URI --with-decryption)"
# The database named in the URI, and the same URI without it (mongorestore picks names itself)
DB="$(printf '%s' "$MONGODB_URI" | sed -E 's#^mongodb(\+srv)?://[^/]+/([^?]*).*#\2#')"
[ -n "$DB" ] && [ "$DB" != "$MONGODB_URI" ] || { echo "MONGODB_URI names no database" >&2; exit 1; }
SERVER_URI="${MONGODB_URI/\/$DB/\/}"
export MONGODB_URI SERVER_URI DB

# Runs a command in the tools container. -i passes our stdin through (the backup archive
# for mongorestore), so callers that send nothing give it </dev/null.
tools() { docker run --rm -i -e MONGODB_URI -e SERVER_URI -e DB -e TARGET "$TOOLS_IMAGE" sh -c "$1"; }
counts() {   # one line per collection: name count
  TARGET="$1" tools 'mongosh "$SERVER_URI" --quiet --eval "
    const d = db.getSiblingDB(process.env.TARGET);
    d.getCollectionNames().sort().forEach(c => print(c + \" \" + d[c].countDocuments()));"' </dev/null
}
latest() {   # newest key; "aws s3 ls" lines start with the date, so sorting them sorts by age
  local k
  k="$(aws s3 ls "s3://$BUCKET/mongodb/" --recursive --region "$REGION" | sort | tail -n 1 | awk '{print $4}')"
  [ -n "$k" ] || { echo "No backups in s3://$BUCKET/mongodb/ yet" >&2; return 1; }
  printf '%s\n' "$k"
}
fetch() {   # download backup $1 to $2
  aws s3 cp "s3://$BUCKET/$1" "$2" --region "$REGION" --only-show-errors
  [ -s "$2" ] || { echo "Backup $1 is empty or missing" >&2; exit 1; }
}

cmd="${1:-}"
case "$cmd" in
  list)
    aws s3 ls "s3://$BUCKET/mongodb/" --recursive --region "$REGION" | sort | tail -n 30 ;;

  test)
    key="${2:-$(latest)}"
    target="${DB}_restore_test"
    tmp="$(mktemp /var/tmp/dreambuilder-restore.XXXXXX)"; trap 'rm -f "$tmp"' EXIT
    echo "Restore test of $key into $target (the live database $DB is not touched)"
    fetch "$key" "$tmp"
    docker pull -q "$TOOLS_IMAGE" >/dev/null
    TARGET="$target" tools 'mongorestore --uri="$SERVER_URI" --archive --gzip --drop \
      --nsInclude="$DB.*" --nsFrom="$DB.*" --nsTo="$TARGET.*" 2>&1 | tail -n 2' < "$tmp"
    echo "== documents per collection: live database now"
    counts "$DB" | tee /var/tmp/restore-live.txt
    echo "== documents per collection: restored copy"
    counts "$target" | tee /var/tmp/restore-copy.txt
    if diff -q /var/tmp/restore-live.txt /var/tmp/restore-copy.txt >/dev/null; then
      echo "RESULT: restored copy matches the live database"
    else
      echo "RESULT: counts differ (normal if the app wrote data since the backup was taken)"
    fi
    TARGET="$target" tools 'mongosh "$SERVER_URI" --quiet --eval "
      const d = db.getSiblingDB(process.env.TARGET);
      d.getCollectionNames().forEach(c => d[c].drop());"' </dev/null
    rm -f /var/tmp/restore-live.txt /var/tmp/restore-copy.txt
    echo "Cleaned up $target" ;;

  restore)
    key="${2:?usage: restore.sh restore KEY --yes}"
    [ "${3:-}" = "--yes" ] || { echo "This REPLACES $DB with $key. Add --yes to go ahead." >&2; exit 2; }
    tmp="$(mktemp /var/tmp/dreambuilder-restore.XXXXXX)"; trap 'rm -f "$tmp"' EXIT
    fetch "$key" "$tmp"
    docker pull -q "$TOOLS_IMAGE" >/dev/null
    tools 'exec mongorestore --uri="$SERVER_URI" --archive --gzip --drop --nsInclude="$DB.*"' < "$tmp"
    echo "Restored $DB from $key" ;;

  *)
    sed -n '2,6p' "$0" >&2; exit 2 ;;
esac
