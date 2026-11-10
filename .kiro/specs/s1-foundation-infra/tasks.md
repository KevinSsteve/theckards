# S1 — Tarefas

- [ ] T1.0 ADRs 001–010 (`docs/adr/`) com requisito, custo fixo mensal, alternativa simples, risco.
- [ ] T1.1 Monorepo pnpm (`apps/web`, `apps/worker`, `packages/domain`, `infra`, `api`, `docs`), tsconfig estrito, ESLint, Vitest, CI base (lint, typecheck, test, Trivy, gitleaks, cdk-nag).
- [ ] T1.2 Bootstrap de contas AWS (Organizations, SCPs mínimas, CloudTrail org, GuardDuty) — IaC onde possível; documentar passo humano de criação de contas em `docs/runbooks/account-bootstrap.md`.
- [ ] T1.3 CDK: Network, Data (RDS, S3, KMS, SQS+DLQ), Auth (Cognito), Edge (CloudFront, WAF, Route53, ACM), App (ECS web/worker, ALB), Email (SES), AppConfig, Scheduler group.
- [ ] T1.4 Pipeline GitHub Actions + OIDC; build de imagem, scan, push ECR, promoção por digest; blue/green com rollback por alarmes; job de migrações.
- [ ] T1.5 Logging pino com redaction, alarmes básicos, SNS de plantão, `GET /healthz` e `/readyz`.
- [ ] T1.6 Budgets + Cost Anomaly Detection por conta.
- [ ] T1.7 Teste: ALB direto recusado; `/healthz` via CloudFront OK (smoke test no pipeline).

**Aceitação:** `cdk deploy` cria tudo sem passos manuais; `/healthz` via CloudFront; ALB direto recusado.
