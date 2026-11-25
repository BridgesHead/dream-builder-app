#!/usr/bin/env bash
# One-time setup of a Dream Builder server. Run on the server from this folder:
#   sudo ./bootstrap.sh staging 010834800857.dkr.ecr.ap-south-1.amazonaws.com/dreambuilder-backend
#   sudo ./bootstrap.sh prod    010834800857.dkr.ecr.ap-south-1.amazonaws.com/dreambuilder-backend
# Safe to re-run: it never overwrites .env once it exists. app.env is written by deploy.sh
# from Parameter Store at every deploy, so it is not created here.
set -euo pipefail

ENV_NAME="${1:?usage: bootstrap.sh <staging|prod> <ecr-repo-uri>}"
ECR_REPO="${2:?usage: bootstrap.sh <staging|prod> <ecr-repo-uri>}"
case "$ENV_NAME" in staging|prod) ;; *) echo "env must be staging or prod" >&2; exit 2 ;; esac
[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 2; }

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR=/opt/dreambuilder
REGISTRY="${ECR_REPO%%/*}"

echo "==> Packages"
command -v docker >/dev/null || { echo "Docker is not installed" >&2; exit 1; }
apt-get update -y
apt-get install -y amazon-ecr-credential-helper python3
# The AWS CLI reads the settings from Parameter Store (deploy.sh)
if ! command -v aws >/dev/null; then
  apt-get install -y awscli || snap install aws-cli --classic
fi
aws --version

echo "==> Docker pulls from ECR using the server's IAM role (no stored passwords)"
install -d -m 700 /root/.docker
if [ -f /root/.docker/config.json ] && grep -q "$REGISTRY" /root/.docker/config.json; then
  echo "    already configured"
elif [ -f /root/.docker/config.json ]; then
  echo "    /root/.docker/config.json exists; add this by hand: \"credHelpers\": {\"$REGISTRY\": \"ecr-login\"}" >&2
else
  printf '{\n  "credHelpers": { "%s": "ecr-login" }\n}\n' "$REGISTRY" > /root/.docker/config.json
  chmod 600 /root/.docker/config.json
fi

echo "==> Swap (only on small servers without any)"
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 3000 ] && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "    added 2 GB swap"
fi

echo "==> App folder $APP_DIR"
install -d -m 750 "$APP_DIR"
install -m 644 "$SRC_DIR/docker-compose.yml" "$APP_DIR/docker-compose.yml"
install -m 644 "$SRC_DIR/Caddyfile" "$APP_DIR/Caddyfile"
install -m 750 "$SRC_DIR/deploy.sh" "$APP_DIR/deploy.sh"

if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" <<EOF
DEPLOY_ENV=$ENV_NAME
AWS_REGION=${AWS_REGION:-ap-south-1}
ECR_REPO=$ECR_REPO
IMAGE_TAG=none
SITE_ADDRESS=:80
EOF
  chmod 640 "$APP_DIR/.env"
elif ! grep -q '^AWS_REGION=' "$APP_DIR/.env"; then
  echo "AWS_REGION=${AWS_REGION:-ap-south-1}" >> "$APP_DIR/.env"
fi

echo "==> Nightly database backup (02:30 Pakistan time) to the environment's S3 backups bucket"
install -m 750 "$SRC_DIR/backup.sh" "$APP_DIR/backup.sh"
install -m 750 "$SRC_DIR/restore.sh" "$APP_DIR/restore.sh"
install -m 644 "$SRC_DIR/dreambuilder-backup.service" /etc/systemd/system/dreambuilder-backup.service
install -m 644 "$SRC_DIR/dreambuilder-backup.timer" /etc/systemd/system/dreambuilder-backup.timer
systemctl daemon-reload
systemctl enable --now dreambuilder-backup.timer
systemctl list-timers dreambuilder-backup.timer --no-pager | sed -n 2p

echo "==> Done. Settings live in Parameter Store (/dreambuilder/$ENV_NAME/); the pipeline deploys."
