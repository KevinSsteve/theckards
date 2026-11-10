# S1 — foundation-infra: Requisitos (guião sec. 5, 9, 13)

## R-INF — Infraestrutura
- R-INF-1 WHEN `cdk deploy` é executado para `staging` ou `prod` THEN o sistema SHALL criar toda a infraestrutura sem passos manuais.
- R-INF-2 O ALB SHALL aceitar tráfego apenas do CloudFront (prefix list gerida + cabeçalho secreto); acesso direto SHALL ser recusado.
- R-INF-3 Existem dois ambientes, `staging` e `prod`, em contas AWS separadas.
- R-INF-4 Recursos com estado (RDS, S3, KMS, Cognito) SHALL ter RemovalPolicy RETAIN e proteção contra eliminação.
- R-INF-5 O S3 SHALL ter versionamento, SSE-KMS, Block Public Access, acesso por CloudFront OAC (estáticos) e SEM Object Lock.
- R-INF-6 A base de dados SHALL ter backups automáticos, PITR e um restauro testado antes do go-live; RTO e RPO definidos por ADR.
- R-INF-7 Contas SHALL ter SCPs mínimas: não desativar CloudTrail/GuardDuty, sem buckets públicos.
- R-INF-8 O pipeline SHALL usar OIDC, promover imagens por digest e fazer deploy blue/green com rollback por alarmes.
- R-INF-9 Cada serviço SHALL expor `/healthz` (liveness) e `/readyz` (BD + fila), com graceful shutdown, timeouts e retries com backoff.
- R-INF-10 WHEN ocorre um incidente grave THEN o sistema SHALL alertar o plantão em <5 min (SNS → email/SMS configuráveis no Admin).
- R-INF-11 AWS Budgets e Cost Anomaly Detection SHALL estar ativos por conta.
- R-INF-12 Antes de cada serviço AWS existe um ADR (requisito, custo fixo mensal, alternativa mais simples, risco).

## Aceitação
`cdk deploy` cria tudo; `/healthz` responde via CloudFront; ALB direto devolve recusa.
