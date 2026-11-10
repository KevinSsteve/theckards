# S1 — Design

## Topologia (us-east-1 primária; ver ADR-001)
```
Route 53 → CloudFront (WAF, Shield Standard)
  ├ /_next/static/*, /assets/* → S3 (OAC)
  └ /* → ALB (SG: CloudFront prefix list; WAF/ALB rule: header X-Origin-Verify do Secrets Manager, rotacionável)
        → ECS Fargate `web` (private subnets)
        ECS Fargate `worker` (SQS)
VPC: 2 AZ, 1 NAT; subnets públicas (ALB), privadas (ECS), isoladas (RDS)
VPC endpoints: S3 (gateway), bedrock-runtime, secretsmanager, kms, sqs, logs, ecr (interface; só os que poupam NAT/custo — ADR)
```

## Componentes CDK (`infra/`)
Stacks: `NetworkStack`, `DataStack` (RDS, S3, KMS, SQS/DLQ), `AuthStack` (Cognito), `EdgeStack` (ACM us-east-1, CloudFront, WAF, Route53), `AppStack` (ECS, ALB, autoscaling, EventBridge Scheduler group, AppConfig), `EmailStack` (SES identity, DKIM, configuration set, SNS bounce/complaint), `ObservabilityStack`, `PipelineStack` (OIDC role). cdk-nag AwsSolutions em todas, supressões justificadas.

## KMS
- `data-key` (simétrica; S3, RDS, SQS, Secrets, coluna).
- `seal-key` (assimétrica ECC_NIST_P256, SIGN_VERIFY, rotação manual com alias versionado; chave antiga mantém-se).
- `anchor-key` ECC_SECG_P256K1 criada só quando `ANCHOR_ENABLED` for ligado pela 1.ª vez (fora do v1 inicial).

## WAF
Managed rules (Common, KnownBadInputs, SQLi, IpReputation), rate-based rules por path (`/api/*/otp`, `/api/guest/*`, login), Bot Control (TARGETED só no registo) — custo no ADR-006.

## ECS
| | staging | prod |
|---|---|---|
| web | 1× 0,5 vCPU/1 GB | 1–4× 1 vCPU/2 GB (min 1; min 2 só com ADR) |
| worker | 1× | 1–3×, step scaling por `ApproximateNumberOfMessagesVisible` |
Deploy: CodeDeploy blue/green ECS, rollback por alarmes 5xx/latência/unhealthy.

## RDS (ADR-002)
PostgreSQL 16+ (confirmar versão suportada), `db.t4g.small` single-AZ prod/`db.t4g.micro` staging, gp3, cifrado, PITR, backup retention 14 d (admin-configurável dentro de 7–35 via CDK context), extensões `citext`, `pgcrypto`. Credenciais no Secrets Manager com rotação. Migrações expand/contract (node-pg-migrate/Drizzle — ADR-003) executadas por task one-off no pipeline.

## ADRs a escrever em T1.0
001 região/contas · 002 RDS vs Aurora · 003 ORM/migrações · 004 worker separado · 005 pdf-lib · 006 WAF/Bot Control · 007 NAT vs VPC endpoints · 008 observabilidade (CloudWatch + X-Ray/OTel) · 009 RTO/RPO · 010 Cognito Essentials + BFF.

## Observabilidade
Logs JSON (pino) com redaction de PII; métricas EMF; alarmes: 5xx, latência p95, tarefas unhealthy, DLQ>0, idade da fila, RDS CPU/storage/conexões, SES bounce/complaint, falhas webhook. Canary Synthetics e RUM em S8. Runbooks em `docs/runbooks/`.
