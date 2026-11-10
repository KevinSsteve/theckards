# S8 — Design

- **Email**: SES domain identity (Easy DKIM), MAIL FROM subdomain (SPF alinhado), DMARC `p=none→quarantine→reject` (política escalonada em runbook), configuration set com eventos → SNS → worker `ses.events` → tabela `email_suppressions`; envio recusa suprimidos. Pedido de saída do sandbox: passo humano documentado (T8.1).
- **Observabilidade**: CloudWatch Synthetics canary (Playwright/Puppeteer runtime), CloudWatch RUM (cookie-less/ sem PII), dashboards por SLO, alarmes composite → SNS → PagerDuty/Opsgenie/email (destino configurável no Admin → Alerts).
- **Retenção jobs**: `retention-sweeper` diário, regras por categoria lidas de `app_settings.retention`; logs 90 d via CloudWatch retention; backups RDS 7–35 d; lifecycle S3 para versões não correntes (valor definido no Admin/ADR); nada apaga registos de assinatura/recibos sem política aprovada.
- **Testes**: k6 (cenários: criar acordo, assinar, verify, upload) a 3×; restauro PITR em instância nova com medição de RTO/RPO e relatório em `docs/runbooks/restore-test.md`; ZAP baseline+active contra staging; Lighthouse CI com budgets; axe-playwright; suíte IDOR.
- **Gates de build**: script `check-legal-approved` (consulta a BD de prod no deploy ou manifesto exportado) + `check-no-draft`; falha pipeline.
- **Anti-abuso**: tabela `abuse_reports`, `users.suspended_at`; suspensão via Admin; WAF rate rules e Bot Control no registo (ADR-006).
- **Go-live**: DNS cutover, HSTS (max-age gradual; preload só depois), alarmes ativos, dry-run de rollback.
