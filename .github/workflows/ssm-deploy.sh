#!/usr/bin/env bash
# Used by deploy-api.yml: asks one server, through AWS Systems Manager, to run
# /opt/dreambuilder/deploy.sh <IMAGE_TAG>, waits for it and prints its output.
# Needs INSTANCE_ID and IMAGE_TAG, and AWS credentials allowed to send the command.
set -euo pipefail
: "${INSTANCE_ID:?}" "${IMAGE_TAG:?}"
[[ "$IMAGE_TAG" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || { echo "odd image tag: $IMAGE_TAG" >&2; exit 2; }

CMD_ID=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "dream-builder api ${IMAGE_TAG::7}" \
  --timeout-seconds 900 \
  --parameters "{\"commands\":[\"/opt/dreambuilder/deploy.sh ${IMAGE_TAG}\"]}" \
  --query Command.CommandId --output text)
echo "SSM command: $CMD_ID"

STATUS=Pending
for _ in $(seq 1 150); do
  STATUS=$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$STATUS" in
    Pending|InProgress|Delayed) sleep 6 ;;
    *) break ;;
  esac
done

aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query '[StandardOutputContent, StandardErrorContent]' --output text || true
echo "Result: $STATUS"
[ "$STATUS" = "Success" ]
