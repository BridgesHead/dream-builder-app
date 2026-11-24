# infra/

Setup note for Dream Builder on AWS (stories AWS-01 and AWS-02): every resource, its region and
who can reach it. Owner: Sami Bhai. Last updated 2026-11-24.

**No secret is ever written in this repo, in a workflow log or in chat.** Secrets live in AWS
Parameter Store (SecureString, encrypted with KMS) and are only read by the server they belong to.

| Story | What it covers | Status |
| --- | --- | --- |
| AWS-01 | Hosting for the API and worker, MongoDB Atlas, picture bucket, Redis (ElastiCache), secrets, CI deploy, email | Staging live and tested end to end; the pipeline deploys it on every merge to `main` (2026-11-24). The dev server is skipped; email not started |
| AWS-02 | Staging and production copies, voice and print buckets, listening-page domain, backups, alerts | Copies and buckets done. Nightly backups with a tested restore done; point-in-time restore waits for the paid Atlas tier. Domain and alerts wait on decisions (below) |
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
| production | Live since 2026-11-24 (release `v0.1.0`, approved by Sami Bhai), with nightly backups | A release tag `v1.2.3`, after Sami Bhai approves in GitHub |

Each environment has its own server, database, database user, buckets, Redis and settings. Two
things are shared: the image registry, which holds the same image both environments run, and, for
now, the Atlas cluster (Sami Bhai, 2026-11-24: one free cluster for both servers until the paid
tier is approved; each environment has its own database and user on it, see MongoDB Atlas below).

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
| Database backups bucket | `dreambuilder-backups-staging-010834800857` | `dreambuilder-backups-prod-010834800857` | Its own server may add and read backups but not delete them; S3 deletes copies after 14 days. AWS admins |
| Settings and secrets | Parameter Store `/dreambuilder/staging/` | `/dreambuilder/prod/` | Read: only its own server. Read/write: AWS admins |
| Admin-only secrets | `/dreambuilder-internal/staging/` | `/dreambuilder-internal/prod/` | AWS admins only (the Redis password, kept so `REDIS_URL` can be rebuilt) |
| MongoDB Atlas database | `dream_builder_staging` on cluster `dreambuilder-staging` (see below) | `dream_builder_prod` on the same cluster, for now | One database user per environment, allowed only its own database. Network: the two servers' Elastic IPs plus named developer IPs |
| GitHub environment | `staging` | `production` (Sami Bhai must approve) | Repo admins |
| Deploy role (GitHub OIDC) | `dreambuilder-deploy-staging` | `dreambuilder-deploy-prod` | Only that GitHub environment of `BridgesHead/dream-builder-app`. It can push the image and deploy to its own server only |

The deploy roles trust GitHub's ID-based name for the repo,
`repo:BridgesHead@360629568/dream-builder-app@1442847901:environment:<env>`. That is the form GitHub
sends for this organisation's repos (seen in CloudTrail, 2026-11-24); a role that trusts the plain
`BridgesHead/dream-builder-app` name is refused. `setup-iam.sh` uses it by default.

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

| | Staging | Production |
| --- | --- | --- |
| Project | `Dream Builder` | same project |
| Cluster | `dreambuilder-staging`, M0 (free), AWS Mumbai, MongoDB 8.0 (created 2026-11-24) | **Same cluster for now** (Sami Bhai, 2026-11-24). Its own cluster, M10 or larger, once Dina adds a payment method in Atlas |
| Database | `dream_builder_staging` | `dream_builder_prod` |
| Database user | `dreambuilder-staging-api`: readWrite on `dream_builder_staging` (and `dream_builder_staging_restore_test`, for restore tests) only, limited to this cluster | `dreambuilder-prod-api`: readWrite on `dream_builder_prod` (and `dream_builder_prod_restore_test`) only |
| Connection string | Parameter Store `/dreambuilder/staging/MONGODB_URI` | `/dreambuilder/prod/MONGODB_URI` |

Passwords are generated by Atlas and stored only in Parameter Store. Network access (IP access list,
shared by both because it belongs to the project): the staging and production Elastic IPs, and
developer IPs labelled with name and date (Sami Bhai today; Anas: *to add*).

Developers get their own Atlas user for staging if they need one; nobody connects to the
production database from a laptop. Home internet IPs change: when one does, add the new one in
Atlas → Database & Network Access → IP Access List and delete the old entry.

**Sharing the free cluster, and what changes later.** M0 has a 512 MB limit shared by both
databases, limited throughput, and no Atlas backups (our own nightly backups cover that, see
Backups). Moving production to its own M10 later: create the cluster and allow
`dreambuilder-prod-api` on it; stop the production API, run `backup.sh`, point
`/dreambuilder/prod/MONGODB_URI` at the new cluster, run `restore.sh restore <that backup> --yes`,
then redeploy. M10 in Mumbai is listed at $0.08 an hour, about $58 a month, before backup storage;
it adds Atlas snapshots with point-in-time restore.

## Settings (Parameter Store)

Each parameter under `/dreambuilder/<env>/` becomes one environment variable for the API and the
worker: the last part of the name is the variable name. `deploy.sh` reads them at every deploy and
writes them to `/opt/dreambuilder/app.env` (mode 600) on the server.

| Variable | Type | Set by |
| --- | --- | --- |
| `S3_REGION`, `S3_BUCKET`, `S3_VOICE_BUCKET`, `S3_PRINT_BUCKET` | String | `setup-env.sh` (always) |
| `S3_BACKUP_BUCKET` | String | `setup-env.sh` (always). Read by `backup.sh` and `restore.sh`; the API ignores it |
| `BACKUP_RETENTION_DAYS` (`16`) | String | `setup-env.sh` (always). The data-deletion email tells parents when the last backup copy is gone: S3 deletes copies after 14 days, rounded up to the next midnight and removed in the background, hence 16. Change it together with `BACKUP_DAYS` in `setup-iam.sh` |
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

Also on each server: the systemd timer `dreambuilder-backup.timer`, which runs `backup.sh` every night
(see Backups), and `restore.sh`.

## Backups

Every night at 02:30 Pakistan time (21:30 UTC, give or take 10 minutes) each server copies its own
database with `mongodump` into its own backups bucket:
`s3://dreambuilder-backups-<env>-010834800857/mongodb/YYYY/MM/DD/<env>-<UTC time>.archive.gz`.
The tools come from the official `mongo:8.0` image, so nothing extra is installed on the server; the
connection string reaches the container through its environment, never a command line or a log.
S3 deletes copies after 14 days. A server can add and read its own backups but cannot delete them
or see the other environment's.

```bash
sudo /opt/dreambuilder/backup.sh                     # take a backup now
sudo /opt/dreambuilder/restore.sh list               # what's there, newest last
sudo /opt/dreambuilder/restore.sh test               # restore the newest into <db>_restore_test, compare, clean up
sudo /opt/dreambuilder/restore.sh restore KEY --yes  # REPLACE the live database with backup KEY
systemctl list-timers dreambuilder-backup.timer      # when the next one runs
journalctl -u dreambuilder-backup --since today      # how the last one went
```

`test` never touches the live database. This is a nightly copy, so a restore can lose up to a day
of changes; restore to a chosen minute (point-in-time) needs the paid Atlas tier (AWS-02, below).

## Files

| Path | Purpose |
| --- | --- |
| `aws/setup-iam.sh` | CloudShell, once: server role, GitHub sign-in, the eight buckets, deploy roles. Safe to re-run |
| `aws/setup-env.sh` | CloudShell, once per environment: Elastic IP, Redis, settings. `--set NAME` adds a secret |
| `aws/ssm-bootstrap.py` | CloudShell: sets up or updates both servers through SSM (`tar -czf kit.tgz -C infra server` first) |
| `aws/bridgehead-iam-policy.json` | The narrow IAM rights the setup user needed. Remove after setup (AWS-04) |
| `server/docker-compose.yml` | The three containers above |
| `server/deploy.sh` | Deploy one image tag with the current settings; roll back if unhealthy |
| `server/bootstrap.sh` | Server setup: folder, ECR login through the server role, AWS CLI, swap, backup timer. Safe to re-run |
| `server/Caddyfile` | HTTPS and security headers in front of the API |
| `server/backup.sh`, `server/dreambuilder-backup.service`, `server/dreambuilder-backup.timer` | The nightly database backup |
| `server/restore.sh` | List, test-restore or restore a backup |

## Runbook

- **Deploy staging:** merge into `main`. **Deploy production:** tag the commit `vX.Y.Z` and approve the run.
- **Deploy or roll back by hand:** on the server, `sudo /opt/dreambuilder/deploy.sh <commit sha>`.
- **Shell on a server:** EC2 console → instance → Connect → Session Manager.
- **Logs:** `cd /opt/dreambuilder && sudo docker compose logs -f api worker`
- **Health:** `curl https://13-234-72-174.sslip.io/api/v1/health` (production: `https://16-4-70-84.sslip.io/api/v1/health`)
- **Backups:** see Backups above. Record every restore test in the table below.
- **Disk:** `deploy.sh` removes images older than 3 days after each successful deploy, so old
  releases do not fill the 19 GB disk; one needed for a rollback is pulled again from ECR.

## AWS-02 items waiting on a decision

- **Point-in-time restore.** Nightly backups are running (above). Restoring to a chosen minute needs
  production on its own M10 or larger cluster with Cloud Backup and continuous restore turned on.
  Waiting for Dina to add a payment method in Atlas. Then: move production (see MongoDB Atlas),
  turn on continuous restore, restore once into a scratch cluster, and record it below.
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

| Date | Environment | Backup | Restored to | Checked | By |
| --- | --- | --- | --- | --- | --- |
| 2026-11-24 | staging | `staging-20261124T121525Z` (25 marker documents written just before it) | `dream_builder_staging_restore_test` | `restore.sh test`: 25 documents restored, 0 failed; document counts per collection match the live database; copy removed, markers removed | Claude for Sami Bhai |
| 2026-11-24 | production | `prod-20261124T121421Z` (database still empty, app not yet deployed) | `dream_builder_prod_restore_test` | `restore.sh test`: restore ran, counts match (no collections yet) | Claude for Sami Bhai |
| 2026-11-24 | production | `prod-20261124T150720Z` (after the first deploy: the app's 13 collections, no documents yet) | `dream_builder_prod_restore_test` | `restore.sh test`: all 13 collections restored, counts match; copy removed | Claude for Sami Bhai |

Also checked on 2026-11-24: a server cannot delete its own backups (AccessDenied) or list the other
environment's backups bucket (AccessDenied).

## Still to do

- Close port 22 once Session Manager is the only way in
- Transactional email, error tracking, uptime checks and alerts, budgets
- Move to UAE (`me-central-1`) when AWS restores it
