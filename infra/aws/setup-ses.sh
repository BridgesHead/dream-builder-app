#!/usr/bin/env bash
# Lets the app send its emails (confirm your email, reset password, deletion notice) through
# Amazon SES. Run in AWS CloudShell (Mumbai) by someone with SES, IAM and SSM permissions:
#
#   bash setup-ses.sh sender@example.com [tester@example.com ...]
#   DOMAIN=example.com bash setup-ses.sh hello@example.com [tester@gmail.com ...]
#
# It does (safe to re-run):
#   1. Asks SES to confirm each address: AWS emails each one a link to open within 24 hours.
#      With DOMAIN set it confirms the whole domain instead and prints the 3 DNS records
#      (DKIM) to add at the domain's DNS host; then any address @DOMAIN can send.
#   2. Lets both servers send email from the sender only (policy "email" on dreambuilder-ec2-role).
#   3. Saves EMAIL_FROM ("Dream Builder <sender>") and SES_REGION for staging and prod in
#      Parameter Store. The next deploy picks them up.
#   4. Shows each address's status and whether the account is still in the SES "sandbox".
#
# The sandbox: a new AWS account can email ONLY confirmed addresses, at most 200 a day. Until
# AWS grants production access (which real parents need, see infra/README.md "Email"), run
# this again with each tester's address. No AWS email? RESEND=1 bash setup-ses.sh ... sends it again.
set -euo pipefail

[ $# -ge 1 ] || { echo "usage: setup-ses.sh sender@example.com [tester@example.com ...]" >&2; exit 2; }
# Lower case, like the app saves addresses (SES may treat "Ali@" and "ali@" as different)
# shellcheck disable=SC2046
set -- $(printf '%s\n' "$@" | tr '[:upper:]' '[:lower:]')
SENDER="$1"
REGION="${REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="$REGION"
FROM_NAME="${FROM_NAME:-Dream Builder}"
DOMAIN="$(printf '%s' "${DOMAIN:-}" | tr '[:upper:]' '[:lower:]')"
EC2_ROLE=dreambuilder-ec2-role
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "Account $ACCOUNT, region $REGION, sender $SENDER${DOMAIN:+, domain $DOMAIN}"

EMAIL_SHAPE='^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
for a in "$@"; do
  [[ "$a" =~ $EMAIL_SHAPE ]] || { echo "\"$a\" is not an email address" >&2; exit 2; }
done
if [ -n "$DOMAIN" ] && [ "${SENDER##*@}" != "$DOMAIN" ]; then
  echo "With DOMAIN=$DOMAIN the sender must be an @$DOMAIN address" >&2; exit 2
fi

status() {   # identity -> True / False / missing
  aws sesv2 get-email-identity --email-identity "$1" --query VerifiedForSendingStatus --output text 2>/dev/null || echo missing
}
confirm() {   # identity (an address or a domain)
  local s; s="$(status "$1")"
  if [ "$s" = "False" ] && [ "${RESEND:-}" = "1" ] && [[ "$1" == *@* ]]; then
    aws sesv2 delete-email-identity --email-identity "$1"; s=missing
  fi
  if [ "$s" = "missing" ]; then
    aws sesv2 create-email-identity --email-identity "$1" --tags Key=Project,Value=dreambuilder >/dev/null
    [[ "$1" == *@* ]] && echo "    $1: AWS has emailed it a confirmation link" || echo "    $1: added"
  else
    echo "    $1: already added"
  fi
}

# ---------------------------------------------------------------------------
echo "==> 1. Addresses SES may use"
if [ -n "$DOMAIN" ]; then
  confirm "$DOMAIN"
  echo "    Add these DNS records at $DOMAIN's DNS host (SES checks them by itself):"
  aws sesv2 get-email-identity --email-identity "$DOMAIN" --query 'DkimAttributes.Tokens' --output text \
    | tr '\t' '\n' | while read -r t; do echo "      CNAME  $t._domainkey.$DOMAIN  ->  $t.dkim.amazonses.com"; done
  echo "      TXT    _dmarc.$DOMAIN  ->  \"v=DMARC1; p=none;\"   (if the domain has no DMARC record yet)"
fi
for a in "$@"; do
  if [ -n "$DOMAIN" ] && [ "${a##*@}" = "$DOMAIN" ]; then continue; fi   # covered by the domain
  confirm "$a"
done

# ---------------------------------------------------------------------------
echo "==> 2. Both servers may send, from $SENDER only"
# In the sandbox SES also checks the RECIPIENT's identity, hence identity/* (still only this
# account's confirmed identities). ses:FromAddress pins the sender.
aws iam put-role-policy --role-name "$EC2_ROLE" --policy-name email --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[
 {\"Sid\":\"SendAppEmail\",\"Effect\":\"Allow\",\"Action\":\"ses:SendEmail\",
  \"Resource\":\"arn:aws:ses:$REGION:$ACCOUNT:identity/*\",
  \"Condition\":{\"StringEquals\":{\"ses:FromAddress\":\"$SENDER\"}}}]}"
echo "    policy \"email\" saved"

# ---------------------------------------------------------------------------
echo "==> 3. Settings for both environments"
for env in staging prod; do
  aws ssm put-parameter --name "/dreambuilder/$env/EMAIL_FROM" --value "$FROM_NAME <$SENDER>" --type String --overwrite >/dev/null
  aws ssm put-parameter --name "/dreambuilder/$env/SES_REGION" --value "$REGION" --type String --overwrite >/dev/null
  echo "    /dreambuilder/$env/EMAIL_FROM and SES_REGION saved (used from the next deploy)"
done

# ---------------------------------------------------------------------------
echo "==> 4. Status"
for id in ${DOMAIN:+"$DOMAIN"} "$@"; do
  if [ -n "$DOMAIN" ] && [ "$id" != "$DOMAIN" ] && [ "${id##*@}" = "$DOMAIN" ]; then continue; fi
  case "$(status "$id")" in
    True) echo "    $id: confirmed" ;;
    *)    echo "    $id: waiting (open the link in AWS's email, or add the DNS records)" ;;
  esac
done
if [ "$(aws sesv2 get-account --query ProductionAccessEnabled --output text)" = "True" ]; then
  echo "    Account: production access, can email anyone"
else
  echo "    Account: SES sandbox, can email ONLY the confirmed addresses above (200 a day)"
fi
