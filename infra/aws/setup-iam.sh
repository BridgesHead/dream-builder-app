#!/usr/bin/env bash
# Creates the IAM pieces Dream Builder needs. Run ONCE in AWS CloudShell (Mumbai region)
# by someone with IAM permissions on the Athar Interactive Media account:
#
#   bash setup-iam.sh
#
# It creates:
#   1. dreambuilder-ec2-role (+ instance profile) attached to both servers:
#      lets them pull images from ECR and receive deploy commands via SSM.
#   2. The GitHub Actions OIDC identity provider (if the account doesn't have it yet).
#   3. Three private buckets per environment: pictures (S3_BUCKET, BE-10), voice recordings
#      (S3_VOICE_BUCKET, BE-15) and print files (S3_PRINT_BUCKET, BE-18). Each server can
#      use ONLY its own environment's buckets, and read ONLY its own settings in
#      Parameter Store (/dreambuilder/<env>/).
#   4. dreambuilder-deploy-staging and dreambuilder-deploy-prod roles for GitHub Actions:
#      each can push to the ECR repo and send a deploy command to ITS OWN server only,
#      and only from the matching GitHub environment of GITHUB_REPO.
# Safe to re-run.
set -euo pipefail

GITHUB_REPO="${GITHUB_REPO:-iamKhan79690/dream-builder-app}"   # set GITHUB_REPO= to skip step 4
REGION="${REGION:-ap-south-1}"
ECR_REPO_NAME="${ECR_REPO_NAME:-dreambuilder-backend}"
STAGING_INSTANCE="${STAGING_INSTANCE:-i-0bd3b0c3c9230134a}"
PROD_INSTANCE="${PROD_INSTANCE:-i-0670e3aa9833ddc69}"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
TAGS="Key=Project,Value=dreambuilder"
echo "Account $ACCOUNT, region $REGION, repo $GITHUB_REPO"

role_exists() { aws iam get-role --role-name "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
echo "==> 1. EC2 role for both servers"
EC2_ROLE=dreambuilder-ec2-role
EC2_PROFILE=dreambuilder-ec2-profile
if ! role_exists "$EC2_ROLE"; then
  aws iam create-role --role-name "$EC2_ROLE" --tags "$TAGS" \
    --description "Dream Builder servers: SSM + ECR pull" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
fi
aws iam attach-role-policy --role-name "$EC2_ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam attach-role-policy --role-name "$EC2_ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly

if ! aws iam get-instance-profile --instance-profile-name "$EC2_PROFILE" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$EC2_PROFILE" --tags "$TAGS" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$EC2_PROFILE" --role-name "$EC2_ROLE"
  echo "    waiting for the instance profile to propagate"; sleep 15
fi

for id in "$STAGING_INSTANCE" "$PROD_INSTANCE"; do
  current="$(aws ec2 describe-iam-instance-profile-associations --region "$REGION" \
    --filters "Name=instance-id,Values=$id" "Name=state,Values=associated,associating" \
    --query 'IamInstanceProfileAssociations[0].IamInstanceProfile.Arn' --output text)"
  if [ "$current" = "None" ]; then
    aws ec2 associate-iam-instance-profile --region "$REGION" --instance-id "$id" \
      --iam-instance-profile "Name=$EC2_PROFILE" >/dev/null
    echo "    attached to $id"
  else
    echo "    $id already has $current"
  fi
done

# ---------------------------------------------------------------------------
echo "==> 2. GitHub OIDC provider"
OIDC_ARN="arn:aws:iam::$ACCOUNT:oidc-provider/token.actions.githubusercontent.com"
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  aws iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 >/dev/null
  echo "    created"
else
  echo "    already exists"
fi

# ---------------------------------------------------------------------------
echo "==> 3. Buckets per environment (private, encrypted) and each server's access"
# Browsers upload voice recordings straight to S3 through short-lived links (BE-15), so the
# voice bucket allows those uploads from the frontend's address. Tighten to the real
# frontend domains once they exist, e.g. FRONTEND_ORIGINS=https://staging.dreambuilder.com
FRONTEND_ORIGINS="${FRONTEND_ORIGINS:-https://*.netlify.app,http://localhost:5173}"

bucket_name() { echo "dreambuilder-$1-$2-$ACCOUNT"; }   # kind, env

make_bucket() {
  local b="$1"
  if aws s3api head-bucket --bucket "$b" >/dev/null 2>&1; then
    echo "    $b already exists"
  else
    aws s3api create-bucket --bucket "$b" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
    echo "    created $b"
  fi
  aws s3api put-public-access-block --bucket "$b" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-encryption --bucket "$b" --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  aws s3api put-bucket-ownership-controls --bucket "$b" \
    --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
  aws s3api put-bucket-tagging --bucket "$b" --tagging 'TagSet=[{Key=Project,Value=dreambuilder}]'
}

voice_cors() {
  local origins
  origins="$(printf '%s' "$FRONTEND_ORIGINS" | python3 -c 'import json,sys; print(json.dumps([o.strip() for o in sys.stdin.read().split(",") if o.strip()]))')"
  aws s3api put-bucket-cors --bucket "$1" --cors-configuration "{\"CORSRules\":[{
    \"AllowedMethods\":[\"PUT\",\"GET\",\"HEAD\"],\"AllowedOrigins\":$origins,
    \"AllowedHeaders\":[\"content-type\",\"content-length\"],\"ExposeHeaders\":[\"ETag\"],
    \"MaxAgeSeconds\":3000}]}"
}

for env in staging prod; do
  for kind in pictures voice print; do make_bucket "$(bucket_name "$kind" "$env")"; done
  voice_cors "$(bucket_name voice "$env")"
done

# Both servers share dreambuilder-ec2-role, so every statement also checks WHICH server is
# asking (ec2:SourceInstanceARN): staging can't touch prod data and the other way round.
instance_condition() {
  echo "\"Condition\":{\"StringEquals\":{\"ec2:SourceInstanceARN\":\"arn:aws:ec2:$REGION:$ACCOUNT:instance/$1\"}}"
}
bucket_statement() {   # sid, bucket, instance
  cat <<EOF
 {"Sid":"$1Objects","Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject"],
  "Resource":"arn:aws:s3:::$2/*",$(instance_condition "$3")},
 {"Sid":"$1List","Effect":"Allow","Action":"s3:ListBucket","Resource":"arn:aws:s3:::$2",
  $(instance_condition "$3")}
EOF
}
settings_statement() {   # sid, env, instance
  cat <<EOF
 {"Sid":"$1Settings","Effect":"Allow",
  "Action":["ssm:GetParametersByPath","ssm:GetParameters","ssm:GetParameter"],
  "Resource":["arn:aws:ssm:$REGION:$ACCOUNT:parameter/dreambuilder/$2",
              "arn:aws:ssm:$REGION:$ACCOUNT:parameter/dreambuilder/$2/*"],
  $(instance_condition "$3")}
EOF
}

# Three separate inline policies, so each one stays readable in the console.
aws iam put-role-policy --role-name "$EC2_ROLE" --policy-name pictures --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[
$(bucket_statement Staging "$(bucket_name pictures staging)" "$STAGING_INSTANCE"),
$(bucket_statement Prod "$(bucket_name pictures prod)" "$PROD_INSTANCE")]}"

aws iam put-role-policy --role-name "$EC2_ROLE" --policy-name voice-and-print --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[
$(bucket_statement StagingVoice "$(bucket_name voice staging)" "$STAGING_INSTANCE"),
$(bucket_statement StagingPrint "$(bucket_name print staging)" "$STAGING_INSTANCE"),
$(bucket_statement ProdVoice "$(bucket_name voice prod)" "$PROD_INSTANCE"),
$(bucket_statement ProdPrint "$(bucket_name print prod)" "$PROD_INSTANCE")]}"

# The AWS-managed AmazonSSMManagedInstanceCore policy (needed for SSM) also allows
# ssm:GetParameter on EVERY parameter, so the allows above are not enough on their own:
# the explicit denies make sure a server can't read the other environment's settings one by
# one, and no server can read the admin-only /dreambuilder-internal/ values.
settings_deny() {   # sid, env, instance
  cat <<EOF
 {"Sid":"$1OnlyItsServer","Effect":"Deny","Action":"ssm:GetParameter*",
  "Resource":["arn:aws:ssm:$REGION:$ACCOUNT:parameter/dreambuilder/$2",
              "arn:aws:ssm:$REGION:$ACCOUNT:parameter/dreambuilder/$2/*"],
  "Condition":{"StringNotEquals":{"ec2:SourceInstanceARN":"arn:aws:ec2:$REGION:$ACCOUNT:instance/$3"}}}
EOF
}

# SecureString values use the AWS-managed aws/ssm key, which lets any role allowed to read
# the parameter decrypt it, so no separate KMS permission is needed.
aws iam put-role-policy --role-name "$EC2_ROLE" --policy-name settings --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[
$(settings_statement Staging staging "$STAGING_INSTANCE"),
$(settings_statement Prod prod "$PROD_INSTANCE"),
$(settings_deny Staging staging "$STAGING_INSTANCE"),
$(settings_deny Prod prod "$PROD_INSTANCE"),
 {\"Sid\":\"NoAdminOnlyValues\",\"Effect\":\"Deny\",\"Action\":\"ssm:GetParameter*\",
  \"Resource\":[\"arn:aws:ssm:$REGION:$ACCOUNT:parameter/dreambuilder-internal\",
              \"arn:aws:ssm:$REGION:$ACCOUNT:parameter/dreambuilder-internal/*\"]}]}"

echo "    staging server -> dreambuilder-{pictures,voice,print}-staging-$ACCOUNT + /dreambuilder/staging/"
echo "    prod server    -> dreambuilder-{pictures,voice,print}-prod-$ACCOUNT + /dreambuilder/prod/"

# ---------------------------------------------------------------------------
echo "==> 4. Deploy roles for GitHub Actions"
if [ -z "$GITHUB_REPO" ]; then
  echo "    skipped: rerun with GITHUB_REPO=owner/repo to create them"
  exit 0
fi
ECR_ARN="arn:aws:ecr:$REGION:$ACCOUNT:repository/$ECR_REPO_NAME"

make_deploy_role() {
  local env_name="$1" gh_env="$2" instance="$3" role="dreambuilder-deploy-$1"
  local trust policy
  trust=$(cat <<EOF
{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
 "Principal":{"Federated":"$OIDC_ARN"},
 "Action":"sts:AssumeRoleWithWebIdentity",
 "Condition":{
  "StringEquals":{"token.actions.githubusercontent.com:aud":"sts.amazonaws.com",
                  "token.actions.githubusercontent.com:sub":"repo:$GITHUB_REPO:environment:$gh_env"}}}]}
EOF
)
  policy=$(cat <<EOF
{"Version":"2012-10-17","Statement":[
 {"Sid":"EcrLogin","Effect":"Allow","Action":"ecr:GetAuthorizationToken","Resource":"*"},
 {"Sid":"EcrPushPull","Effect":"Allow","Resource":"$ECR_ARN","Action":[
   "ecr:BatchCheckLayerAvailability","ecr:InitiateLayerUpload","ecr:UploadLayerPart",
   "ecr:CompleteLayerUpload","ecr:PutImage","ecr:BatchGetImage",
   "ecr:GetDownloadUrlForLayer","ecr:DescribeImages"]},
 {"Sid":"DeployToOwnServer","Effect":"Allow","Action":"ssm:SendCommand","Resource":[
   "arn:aws:ec2:$REGION:$ACCOUNT:instance/$instance",
   "arn:aws:ssm:$REGION::document/AWS-RunShellScript"]},
 {"Sid":"ReadDeployResult","Effect":"Allow","Action":[
   "ssm:GetCommandInvocation","ssm:ListCommandInvocations"],"Resource":"*"}]}
EOF
)
  if role_exists "$role"; then
    aws iam update-assume-role-policy --role-name "$role" --policy-document "$trust"
  else
    aws iam create-role --role-name "$role" --tags "$TAGS" \
      --description "GitHub Actions deploy to Dream Builder $env_name" \
      --assume-role-policy-document "$trust" >/dev/null
  fi
  aws iam put-role-policy --role-name "$role" --policy-name deploy --policy-document "$policy"
  echo "    $gh_env: AWS_DEPLOY_ROLE_ARN=arn:aws:iam::$ACCOUNT:role/$role  EC2_INSTANCE_ID=$instance"
}

make_deploy_role staging staging    "$STAGING_INSTANCE"
make_deploy_role prod    production "$PROD_INSTANCE"

echo
echo "Done. Put the two values printed for each environment into GitHub:"
echo "  repo Settings > Environments > staging / production > Environment variables"
echo "SSM can take a few minutes to see the servers after the role is attached; check with:"
echo "  aws ssm describe-instance-information --query 'InstanceInformationList[].[InstanceId,PingStatus]' --output text"
