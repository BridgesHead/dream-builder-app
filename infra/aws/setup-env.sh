#!/usr/bin/env bash
# Sets up one environment's AWS pieces. Run in AWS CloudShell (Mumbai), after setup-iam.sh:
#
#   bash setup-env.sh staging
#   bash setup-env.sh prod
#
# It creates (and is safe to re-run; nothing that exists is replaced):
#   1. An Elastic IP for the environment's server, so its address never changes
#      (Atlas only lets in the addresses on its access list).
#   2. Managed Redis (ElastiCache, Valkey) for the BullMQ queue: private to the VPC,
#      reachable only from this environment's server, TLS + password, never evicts jobs.
#   3. The environment's settings in Parameter Store under /dreambuilder/<env>/.
#      Each parameter's name is the API's environment variable name. Secrets are
#      SecureString. deploy.sh reads them on the server at every deploy.
#
# Not done here: MONGODB_URI (added when the Atlas cluster is made), FAL_KEY and the
# Stripe keys (add them with: bash setup-env.sh <env> --set NAME). See infra/README.md.
set -euo pipefail

ENV_NAME="${1:?usage: setup-env.sh <staging|prod> [--set NAME]}"
case "$ENV_NAME" in
  staging) INSTANCE="${STAGING_INSTANCE:-i-0bd3b0c3c9230134a}" ;;
  prod)    INSTANCE="${PROD_INSTANCE:-i-0670e3aa9833ddc69}" ;;
  *) echo "environment must be staging or prod" >&2; exit 2 ;;
esac
REGION="${REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="$REGION"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
P="/dreambuilder/$ENV_NAME"                       # what the server may read
INTERNAL="/dreambuilder-internal/$ENV_NAME"       # what only admins may read
TAGS=(Key=Project,Value=dreambuilder "Key=Environment,Value=$ENV_NAME")

param_exists() { aws ssm get-parameter --name "$1" >/dev/null 2>&1; }
put_param() {   # name, value, type; overwrites
  aws ssm put-parameter --name "$1" --value "$2" --type "$3" --overwrite >/dev/null
}
put_param_once() {   # name, value, type; only if missing
  if param_exists "$1"; then echo "    $1 kept"; else
    aws ssm put-parameter --name "$1" --value "$2" --type "$3" \
      --tags Key=Project,Value=dreambuilder >/dev/null
    echo "    $1 set"
  fi
}
random_secret() { python3 -c 'import secrets; print(secrets.token_urlsafe(48))'; }

# ---------------------------------------------------------------------------
# Typing a secret in: bash setup-env.sh staging --set FAL_KEY
# (asks for the value without showing it; nothing lands in the shell history)
if [ "${2:-}" = "--set" ]; then
  NAME="${3:?usage: setup-env.sh <env> --set NAME}"
  [[ "$NAME" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "NAME must look like FAL_KEY" >&2; exit 2; }
  read -r -s -p "Value for $P/$NAME (hidden): " VALUE; echo
  [ -n "$VALUE" ] || { echo "empty value, nothing changed" >&2; exit 2; }
  case "$NAME" in *KEY*|*SECRET*|*TOKEN*|*PASSWORD*|*URI*|*URL*) TYPE=SecureString ;; *) TYPE=String ;; esac
  put_param "$P/$NAME" "$VALUE" "$TYPE"
  echo "Saved $P/$NAME as $TYPE. Redeploy (or run deploy.sh with the current tag) to use it."
  exit 0
fi

echo "Environment $ENV_NAME, server $INSTANCE, account $ACCOUNT, region $REGION"
read -r AZ VPC_ID SERVER_SG <<<"$(aws ec2 describe-instances --instance-ids "$INSTANCE" \
  --query 'Reservations[0].Instances[0].[Placement.AvailabilityZone,VpcId,SecurityGroups[0].GroupId]' \
  --output text)"

# ---------------------------------------------------------------------------
echo "==> 1. Elastic IP"
EIP="$(aws ec2 describe-addresses --filters "Name=instance-id,Values=$INSTANCE" \
  --query 'Addresses[0].PublicIp' --output text)"
if [ "$EIP" = "None" ]; then
  ALLOC="$(aws ec2 describe-addresses --filters "Name=tag:Name,Values=dreambuilder-$ENV_NAME" \
    --query 'Addresses[0].AllocationId' --output text)"
  if [ "$ALLOC" = "None" ]; then
    ALLOC="$(aws ec2 allocate-address --domain vpc --query AllocationId --output text \
      --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=dreambuilder-$ENV_NAME},{Key=Project,Value=dreambuilder},{Key=Environment,Value=$ENV_NAME}]")"
  fi
  aws ec2 associate-address --instance-id "$INSTANCE" --allocation-id "$ALLOC" >/dev/null
  EIP="$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)"
  echo "    attached $EIP (the server's public address changed to this one)"
else
  echo "    $EIP already attached"
fi

# ---------------------------------------------------------------------------
echo "==> 2. Managed Redis (ElastiCache, Valkey)"
RG="dreambuilder-$ENV_NAME-redis"
SUBNET_GROUP=dreambuilder-redis
REDIS_SG_NAME="dreambuilder-$ENV_NAME-redis-sg"

# Newest Valkey 8.x the region offers, and its parameter group family
read -r VK_VERSION VK_FAMILY <<<"$(aws elasticache describe-cache-engine-versions --engine valkey \
  --query 'CacheEngineVersions[].[EngineVersion,CacheParameterGroupFamily]' --output text \
  | awk '$1 ~ /^8\./' | sort -V | tail -n1)"
[ -n "${VK_VERSION:-}" ] || { echo "no Valkey 8.x in $REGION" >&2; exit 1; }
PARAM_GROUP="dreambuilder-${VK_FAMILY}-noeviction"

if ! aws elasticache describe-cache-subnet-groups --cache-subnet-group-name "$SUBNET_GROUP" >/dev/null 2>&1; then
  SUBNETS="$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" \
    --query 'Subnets[].SubnetId' --output text)"
  # shellcheck disable=SC2086
  aws elasticache create-cache-subnet-group --cache-subnet-group-name "$SUBNET_GROUP" \
    --cache-subnet-group-description "Dream Builder Redis" --subnet-ids $SUBNETS >/dev/null
  echo "    subnet group $SUBNET_GROUP created"
fi

if ! aws elasticache describe-cache-parameter-groups --cache-parameter-group-name "$PARAM_GROUP" >/dev/null 2>&1; then
  aws elasticache create-cache-parameter-group --cache-parameter-group-name "$PARAM_GROUP" \
    --cache-parameter-group-family "$VK_FAMILY" \
    --description "BullMQ: never evict queued jobs" >/dev/null
  echo "    parameter group $PARAM_GROUP created"
fi
# BullMQ requires noeviction: Redis must never silently drop a queued job.
aws elasticache modify-cache-parameter-group --cache-parameter-group-name "$PARAM_GROUP" \
  --parameter-name-values ParameterName=maxmemory-policy,ParameterValue=noeviction >/dev/null

REDIS_SG="$(aws ec2 describe-security-groups --filters "Name=group-name,Values=$REDIS_SG_NAME" "Name=vpc-id,Values=$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text)"
if [ "$REDIS_SG" = "None" ]; then
  REDIS_SG="$(aws ec2 create-security-group --group-name "$REDIS_SG_NAME" --vpc-id "$VPC_ID" \
    --description "Dream Builder $ENV_NAME Redis: only from the $ENV_NAME server" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$REDIS_SG_NAME},{Key=Project,Value=dreambuilder},{Key=Environment,Value=$ENV_NAME}]" \
    --query GroupId --output text)"
  aws ec2 authorize-security-group-ingress --group-id "$REDIS_SG" \
    --ip-permissions "IpProtocol=tcp,FromPort=6379,ToPort=6379,UserIdGroupPairs=[{GroupId=$SERVER_SG,Description=$ENV_NAME server}]" >/dev/null
  echo "    security group $REDIS_SG_NAME created (port 6379 from the $ENV_NAME server only)"
fi

if ! aws elasticache describe-replication-groups --replication-group-id "$RG" >/dev/null 2>&1; then
  # The password is saved before anything else, so a dropped CloudShell can't lose it.
  if ! param_exists "$INTERNAL/REDIS_AUTH_TOKEN"; then
    put_param "$INTERNAL/REDIS_AUTH_TOKEN" "$(python3 -c 'import secrets; print(secrets.token_hex(32))')" SecureString
  fi
  TOKEN="$(aws ssm get-parameter --name "$INTERNAL/REDIS_AUTH_TOKEN" --with-decryption --query Parameter.Value --output text)"
  aws elasticache create-replication-group --replication-group-id "$RG" \
    --replication-group-description "Dream Builder $ENV_NAME BullMQ queue" \
    --engine valkey --engine-version "$VK_VERSION" --cache-node-type cache.t4g.micro \
    --num-cache-clusters 1 --preferred-cache-cluster-a-zs "$AZ" \
    --cache-subnet-group-name "$SUBNET_GROUP" --security-group-ids "$REDIS_SG" \
    --cache-parameter-group-name "$PARAM_GROUP" \
    --transit-encryption-enabled --at-rest-encryption-enabled --auth-token "$TOKEN" \
    --tags "${TAGS[@]}" >/dev/null
  unset TOKEN
  echo "    $RG creating (Valkey $VK_VERSION, cache.t4g.micro, $AZ); this takes 5-15 minutes"
fi

for _ in $(seq 1 90); do
  STATUS="$(aws elasticache describe-replication-groups --replication-group-id "$RG" \
    --query 'ReplicationGroups[0].Status' --output text)"
  [ "$STATUS" = "available" ] && break
  sleep 20
done
[ "$STATUS" = "available" ] || { echo "    $RG still $STATUS; re-run this script later" >&2; exit 1; }
REDIS_HOST="$(aws elasticache describe-replication-groups --replication-group-id "$RG" \
  --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address' --output text)"
TOKEN="$(aws ssm get-parameter --name "$INTERNAL/REDIS_AUTH_TOKEN" --with-decryption --query Parameter.Value --output text)"
put_param "$P/REDIS_URL" "rediss://:$TOKEN@$REDIS_HOST:6379" SecureString
unset TOKEN
echo "    $RG available at $REDIS_HOST:6379 (TLS); $P/REDIS_URL saved"

# ---------------------------------------------------------------------------
echo "==> 3. Settings in Parameter Store ($P/)"
# Bucket names and region always follow the setup, so they are (re)written every time.
put_param "$P/S3_REGION" "$REGION" String
put_param "$P/S3_BUCKET" "dreambuilder-pictures-$ENV_NAME-$ACCOUNT" String
put_param "$P/S3_VOICE_BUCKET" "dreambuilder-voice-$ENV_NAME-$ACCOUNT" String
put_param "$P/S3_PRINT_BUCKET" "dreambuilder-print-$ENV_NAME-$ACCOUNT" String
put_param "$P/S3_BACKUP_BUCKET" "dreambuilder-backups-$ENV_NAME-$ACCOUNT" String   # backup.sh
# What the data-deletion email tells parents about backups. The backups bucket deletes copies
# after 14 days (setup-iam.sh BACKUP_DAYS); S3 rounds that up to the next midnight and removes
# them in the background, so 16 is the honest "gone by" figure. Change both together.
put_param "$P/BACKUP_RETENTION_DAYS" 16 String
echo "    bucket names and region written"

# The rest is only set if missing, so later edits in Parameter Store are kept.
API_HOST="$(echo "$EIP" | tr . -).sslip.io"   # temporary HTTPS name until a real domain
put_param_once "$P/API_URL" "https://$API_HOST" String
put_param_once "$P/APP_URL" "https://$API_HOST" String          # replace with the frontend's URL
put_param_once "$P/SITE_ADDRESS" "$API_HOST" String             # Caddy's HTTPS name
put_param_once "$P/LOG_LEVEL" info String
put_param_once "$P/AI_PROVIDER" stub String
put_param_once "$P/CONSENT_TEXT_VERSION" 2026-11-v1 String
put_param_once "$P/TRUST_PROXY_HOPS" 1 String
put_param_once "$P/JWT_ACCESS_SECRET" "$(random_secret)" SecureString

echo
echo "Done: $ENV_NAME server at $EIP, API address https://$API_HOST"
echo "Still to add: $P/MONGODB_URI (Atlas), and when ready FAL_KEY, STRIPE_SECRET_KEY,"
echo "STRIPE_WEBHOOK_SECRET with:  bash setup-env.sh $ENV_NAME --set NAME"
aws ssm get-parameters-by-path --path "$P/" --query 'Parameters[].[Name,Type]' --output text | sort
