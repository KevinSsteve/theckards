# S11 — Tarefas (incrementais; cada uma entra no marco da spec que a consome)

**M1**
- [ ] T11.1 Auth admin: grupo `admins`, MFA, sessão ADMIN, `admin_users`, step-up, seed do owner, `withRoute({auth:'admin'})`, testes de privilégio/IDOR.
- [ ] T11.2 `app_settings` + history + `settingsRegistry` + UI genérica + auditoria + rollback.
- [ ] T11.3 Flags via AppConfig (criação de versão + deployment) e leitura na app/worker.
- [ ] T11.4 Secções Legal (editar/aprovar), Email (remetente, templates, supressões), AI (com "Test model"), Plans & Limits (seed da sec. 2).
- [ ] T11.5 Integrations: segredos write-only no Secrets Manager (Google OAuth, Stripe, RPC Base), destinos de alerta.

**M2**
- [ ] T11.6 Overview (métricas de negócio, filas, DLQ, email, IA) e Audit log viewer/export.
- [ ] T11.7 Users (suspender/reativar) e Abuse reports; Jobs (reprocessar DLQ/webhooks/emails).

**M3/M4**
- [ ] T11.8 Retention settings + sweeper config; Launch readiness (checks automáticos da sec. 13).
- [ ] T11.9 Alarmes (ações admin sensíveis, falhas de login admin), runbooks (`admin-access-recovery.md`: recuperação do owner via CDK).
- [ ] T11.10 Testes e2e Playwright do fluxo "configurar tudo do zero" em staging; a11y; noindex.

**M5**
- [ ] T11.11 Secção Anti-fraude (limiares) e toggle do perfil público.

**Aceitação:** ver requirements.md.
