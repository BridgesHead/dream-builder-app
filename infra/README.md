# infra/

Setup note for Dream Builder on AWS (stories AWS-01 and AWS-02): every resource, its region and
who can reach it. Owner: Sami Bhai. Last updated 2026-11-24.

**No secret is ever written in this repo, in a workflow log or in chat.** Secrets live in AWS
Parameter Store (SecureString, encrypted with KMS) and are only read by the server they belong to.

| Story | What it covers | Status |
| --- | --- | --- |
| AWS-01 | Hosting for the API and worker, MongoDB Atlas, picture bucket, Redis (ElastiCache), secrets, CI deploy, email | Staging live and tested end to end (2026-11-24). The pipeline waits for the GitHub environments; the dev server is skipped; email not started |
| AWS-02 | Staging and production copies, voice and print buckets, listening-page domain, backups, alerts | Copies and buckets done; domain, backups and alerts wait on decisions (below) |
| AWS-03 | Autoscaling, WAF, IAM review, encryption checks, budgets and dashboards | Not started |
| AWS-04 | Production go-live and handover of access | Not started |

What the app needs to run is listed in `apps/api/README.md`: two programs from one image (the API,
and the job worker), the health check `GET /api/v1/health`, and the environment variables.

## Region

**Mumbai (`ap-south-1`) for now; the UAE (`me-central-1`) later.** UAE was the region agreed with
the client, but AWS has shown it as unable to run customer workloads since the March 2026 damage to
its data centres. Sami Bhai decided to build in Mumbai and move once AWS restores UAE.
The region and instance IDs are variables at the top of each script and of the workflow, so the
move is: new servers in UAE, rerun the scripts with `REGION=me-central-1` and the new IDs, copy the
database and buckets, switch DNS. MongoDB Atlas is in AWS Mumbai as
well, so the app and its database stay in the same region.

## Environments

| Environment | Status | Deployed by |
| --- | --- | --- |
| dev | **Not created** (Sami Bhai, 2026-11-24: "skip it at the moment"). Staging plays its part: every merge to `main` lands there. | — |
| staging | Live | Every merge to `main`, automatically |
| production | Servers, buckets, Redis and settings ready; database waits for the backup decision (see AWS-02) | A release tag `v1.2.3`, after Sami Bhai approves in GitHub |

Each environment has its own server, database, buckets, Redis and settings. Nothing is shared
except the image registry, which holds the same image both environments run.

## Resource inventory

AWS account `010834800857` (Athar Interactive Media). "AWS admins" means the account's IAM users with
admin rights (today: the client's admin, and Sami Bhai as `BridgeHead_Sami`).

### Per environment

| Resource | Staging | Production | Who can reach it |
| --- | --- | --- | --- |
| Server (EC2, Ubuntu, Arm) | `i-0bd3b0c3c9230134a`, t4g.small, ap-south-1c | `i-0670e3aa9833ddc69`, m7g.medium, ap-south-1b | AWS admins through Session Manager. SSH (port 22) only from Sami Bhai's IP (one /32 address) |
| Fixed public IP (Elastic IP) | `13.234.72.174` | `16.4.70.84` | Public on 80/443 (Caddy, HTTPS). Atlas trusts these addresses |
| Firewall (security group) | `dreambuilder-staging-sg` | `dreambuilder-prod-sg` | 80, 443 from anywhere; 22 from Sami Bhai's IP only |
| Temporary API address | `https://13-234-72-174.sslip.io` | `https://16-4-70-84.sslip.io` | Public. Replaced by real domains when DNS is ready |
| Redis (ElastiCache, Valkey 8.2) | `dreambuilder-staging-redis` | `dreambuilder-prod-redis` | Only its own server (security group `dreambuilder-<env>-redis-sg`, port 6379), with TLS and a password |
| Pictures bucket (BE-10) | `dreambuilder-pictures-staging-010834800857` | `dreambuilder-pictures-prod-010834800857` | Only its own server, and AWS admins |
| Voice recordings bucket (BE-15) | `dreambuilder-voice-staging-010834800857` | `dreambuilder-voice-prod-010834800857` | Same. Browsers may upload/download with signed links from the frontend's address only (CORS) |
| Print files bucket (BE-18) | `dreambuilder-print-staging-010834800857` | `dreambuilder-print-prod-010834800857` | Only its own server, and AWS admins |
| Settings and secrets | Parameter Store `/dreambuilder/staging/` | `/dreambuilder/prod/` | Read: only its own server. Read/write: AWS admins |
| Admin-only secrets | `/dreambuilder-internal/staging/` | `/dreambuilder-internal/prod/` | AWS admins only (the Redis password, kept so `REDIS_URL` can be rebuilt) |
| MongoDB Atlas cluster | `dreambuilder-staging` (see below) | Not yet created | Database user per environment. Network: the server's Elastic IP plus named developer IPs |
| GitHub environment | `staging` | `production` (Sami Bhai must approve) | Repo admins |
| Deploy role (GitHub OIDC) | `dreambuilder-deploy-staging` | `dreambuilder-deploy-prod` | Only that GitHub environment of `BridgesHead/dream-builder-app`. It can push the image and deploy to its own server only |

All buckets block public access, encrypt at rest (SSE-S3) and enforce bucket-owner object ownership.
Redis uses encryption in transit and at rest, and the `noeviction` policy that BullMQ requires
(parameter group `dreambuilder-valkey8-noeviction`). It has one node and no replica, so a node
failure loses queued jobs that have not run; good enough for staging and launch, revisit in AWS-03.

### Shared

| Resource | Name | Who can reach it |
| --- | --- | --- |
| Image registry (ECR) | `dreambuilder-backend` | Both deploy roles push and read; both servers pull |
| Server role | `dreambuilder-ec2-role` (instance profile `dreambuilder-ec2-profile`) | Used by both servers. Every bucket and Parameter Store grant in it is tied to one server's instance ID, and explicit denies override the broad `ssm:GetParameter` in AWS's `AmazonSSMManagedInstanceCore`, so staging cannot read production data or settings, and the other way round (tested 2026-11-24 from both servers) |
| GitHub sign-in for AWS | OIDC provider `token.actions.githubusercontent.com` | GitHub Actions of this repo only (through the deploy roles above) |
| Redis network | Subnet group `dreambuilder-redis` | — |

### MongoDB Atlas

Atlas organisation: "Dina's Org" (Athar Interactive Media). Dina is Organization Owner; Sami Bhai is
Organization Project Creator and Project Owner of the project below.

| | Staging (created 2026-11-24) | Production (not created yet) |
| --- | --- | --- |
| Project | `Dream Builder` | same project |
| Cluster | `dreambuilder-staging`, M0 (free), AWS Mumbai, MongoDB 8.0 | M10 or larger, AWS Mumbai (needed for backups, below) |
| Database | `dream_builder_staging` | `dream_builder_prod` |
| Database user | `dreambuilder-staging-api`: readWrite on `dream_builder_staging` only, limited to this cluster. Password generated by Atlas and stored only in Parameter Store | `dreambuilder-prod-api`, readWrite on `dream_builder_prod` only |
| Network access (IP access list) | the staging server's Elastic IP; Sami Bhai's IP of the day (labelled with the date); Anas: *to add* | the production server's Elastic IP only |
| Connection string | Parameter Store `/dreambuilder/staging/MONGODB_URI` | `/dreambuilder/prod/MONGODB_URI` |

Developers get their own Atlas user for staging if they need one; nobody connects to the
production database from a laptop. Home internet IPs change: when one does, add the new one in
Atlas → Database & Network Access → IP Access List and delete the old entry.

## Settings (Parameter Store)

Each parameter under `/dreambuilder/<env>/` becomes one environment variable for the API and the
worker: the last part of the name is the variable name. `deploy.sh` reads them at every deploy and
writes them to `/opt/dreambuilder/app.env` (mode 600) on the server.

| Variable | Type | Set by |
| --- | --- | --- |
| `S3_REGION`, `S3_BUCKET`, `S3_VOICE_BUCKET`, `S3_PRINT_BUCKET` | String | `setup-env.sh` (always) |
| `REDIS_URL` | SecureString | `setup-env.sh`, once Redis is up |
| `JWT_ACCESS_SECRET` | SecureString | `setup-env.sh`, random, only if missing |
| `API_URL`, `APP_URL`, `SITE_ADDRESS` | String | `setup-env.sh` with the temporary sslip.io name, only if missing. Change when the domains exist |
| `LOG_LEVEL` (`info`), `AI_PROVIDER` (`stub`), `CONSENT_TEXT_VERSION`, `TRUST_PROXY_HOPS` (`1`) | String | `setup-env.sh`, only if missing |
| `MONGODB_URI` | SecureString | By hand, from Atlas |
| `FAL_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | SecureString | By hand, when the keys exist. Staging takes Stripe **test** keys only; the API refuses a live key outside production |

`S3_VOICE_BUCKET` and `S3_PRINT_BUCKET` are ready for the BE-15 and BE-18 code; the API does not read
them yet. Switching `AI_PROVIDER` to `fal` needs `FAL_KEY` first.

**Add or change a secret** (in CloudShell; the value is typed hidden and never lands in history):

```bash
bash infra/aws/setup-env.sh staging --set FAL_KEY
```

**Change a plain setting:** `aws ssm put-parameter --name /dreambuilder/staging/LOG_LEVEL --value debug --type String --overwrite`

A changed setting is used at the next deploy. To apply it now, on the server:
`sudo /opt/dreambuilder/deploy.sh "$(sed -n 's/^IMAGE_TAG=//p' /opt/dreambuilder/.env)"`

## How a deploy works

```
merge to main ──► build image (arm64) ──► ECR :<commit> ──► SSM ──► staging server
tag v1.2.3    ──► Sami Bhai approves ──► same image :<commit> ──► SSM ──► production server
```

1. `.github/workflows/deploy-api.yml` builds `apps/api/Dockerfile` once per merge to `main`, pushes it to
   ECR tagged with the commit, and tells the staging server (through AWS Systems Manager, no SSH) to run
   `/opt/dreambuilder/deploy.sh <commit>`.
2. `deploy.sh` renders the settings from Parameter Store, pulls the image, restarts the API and the
   worker and waits for `GET /api/v1/health`. If the new version is not healthy within 3 minutes it
   switches back to the previous one and the workflow fails.
3. Production never builds. A tag `vX.Y.Z` on a commit that already ran on staging waits for Sami Bhai's
   approval in GitHub, then deploys that exact image.

No AWS keys are stored in GitHub: each environment signs in with OIDC to its own deploy role.

GitHub setup (repo admin, once): Settings → Environments →
- `staging`: variables `AWS_DEPLOY_ROLE_ARN=arn:aws:iam::010834800857:role/dreambuilder-deploy-staging`,
  `EC2_INSTANCE_ID=i-0bd3b0c3c9230134a`; deployment branch `main`.
- `production`: variables `AWS_DEPLOY_ROLE_ARN=arn:aws:iam::010834800857:role/dreambuilder-deploy-prod`,
  `EC2_INSTANCE_ID=i-0670e3aa9833ddc69`; required reviewer Sami Bhai; deployment tags `v*`.

## What runs on each server (`/opt/dreambuilder`)

| Container | What it is |
| --- | --- |
| `api` | The API (`tsx src/index.ts`), port 3000 inside Docker only |
| `worker` | Same image, `tsx src/worker.ts`: takes story jobs off the Redis queue |
| `caddy` | Ports 80/443; gets and renews the HTTPS certificate for `SITE_ADDRESS` |

MongoDB (Atlas) and Redis (ElastiCache) are managed services outside the server.

## Files

| Path | Purpose |
| --- | --- |
| `aws/setup-iam.sh` | CloudShell, once: server role, GitHub sign-in, the six buckets, deploy roles. Safe to re-run |
| `aws/setup-env.sh` | CloudShell, once per environment: Elastic IP, Redis, settings. `--set NAME` adds a secret |
| `aws/ssm-bootstrap.py` | CloudShell: sets up or updates both servers through SSM (`tar -czf kit.tgz -C infra server` first) |
| `aws/bridgehead-iam-policy.json` | The narrow IAM rights the setup user needed. Remove after setup (AWS-04) |
| `server/docker-compose.yml` | The three containers above |
| `server/deploy.sh` | Deploy one image tag with the current settings; roll back if unhealthy |
| `server/bootstrap.sh` | One-time server setup: folder, ECR login through the server role, AWS CLI, swap |
| `server/Caddyfile` | HTTPS and security headers in front of the API |

## Runbook

- **Deploy staging:** merge into `main`. **Deploy production:** tag the commit `vX.Y.Z` and approve the run.
- **Deploy or roll back by hand:** on the server, `sudo /opt/dreambuilder/deploy.sh <commit sha>`.
- **Shell on a server:** EC2 console → instance → Connect → Session Manager.
- **Logs:** `cd /opt/dreambuilder && sudo docker compose logs -f api worker`
- **Health:** `curl https://13-234-72-174.sslip.io/api/v1/health`

## AWS-02 items waiting on a decision

- **Backups and point-in-time restore.** The free M0 cluster has no backups. Daily snapshots with
  point-in-time restore need M10 or larger (a monthly cost) for production, and for staging if wanted.
  Once approved: turn on Cloud Backup with continuous restore, restore once into a scratch cluster,
  and record it in the table below.
- **Listening-page domain.** The PRD suggests `voiceanchor.dreambuilder.com`. Needs whoever controls
  the domain's DNS. The link printed in QR codes must be fixed before the first print run; proposed:
  `https://voiceanchor.<domain>/l/<random id>` (random, unguessable, never a database ID or a name).
- **Real API and frontend addresses** to replace sslip.io, then `APP_URL`, `API_URL`, `SITE_ADDRESS`
  and the voice buckets' CORS origins (`FRONTEND_ORIGINS=… bash setup-iam.sh`).

### Staging checks (2026-11-24)

Run on the staging server against the real services, with the API image built from `dev`:

| Check | Result |
| --- | --- |
| `GET https://13-234-72-174.sslip.io/api/v1/health` from the internet | 200, `database: connected`, HTTP/2, HSTS; plain HTTP redirects to HTTPS |
| All 14 settings from Parameter Store reach the containers unchanged | match (compared by hash, nothing printed) |
| Redis from the API container | PONG over TLS, `maxmemory-policy` = `noeviction` |
| Pictures, voice and print buckets from the API container | write, read and delete work |
| Production's bucket from the staging container | refused (AccessDenied) |
| Production's settings from the staging server, and the other way round | refused (AccessDeniedException) |
| Worker | started, no Redis errors in its log |

### Restore tests

| Date | Environment | Restored to | Point in time | Checked | By |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — |

## Still to do

- Close port 22 once Session Manager is the only way in
- Transactional email, error tracking, uptime checks and alerts, budgets
- Move to UAE (`me-central-1`) when AWS restores it
