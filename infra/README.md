# infra/

Infrastructure as code for Dream Builder on AWS (UAE region). Owner: Sami Bhai.

This folder is empty for now. It is where the guide's AWS stories go, for example as Terraform:

| Story | What goes here |
| --- | --- |
| AWS-01 | Dev: API and worker hosting, MongoDB Atlas cluster, S3 picture bucket, Redis (ElastiCache), secrets, CI deploy, email |
| AWS-02 | Staging and production copies, voice and print buckets, listening-page domain, backups, alerts |
| AWS-03 | Autoscaling, WAF, IAM review, encryption checks, budgets and dashboards |
| AWS-04 | Production go-live and handover of access |

What the app needs to run is listed in `apps/api/README.md`: two programs from one image
(`pnpm start` for the API, `pnpm worker` for the job worker), the health check
`GET /api/v1/health`, and the environment variables.

Never put secrets in this folder. They live in AWS Secrets Manager or Parameter Store.
