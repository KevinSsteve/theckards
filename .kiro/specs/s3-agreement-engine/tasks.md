# S3 — Tarefas

- [ ] T3.1 `packages/domain`: máquina de estados, enums→CHECK, schemas, JCS, testes de propriedades.
- [ ] T3.2 Três modelos (EN) + formulário guiado (react-hook-form + zod partilhado) + copy deck i18n.
- [ ] T3.3 Migrações (users, agreements, agreement_versions, parties, milestones, outbox, idempotency_keys), outbox publisher, render PDF determinístico, versões e `content_sha256`, pré-visualização p95 <10 s (medir).
- [ ] T3.4 Convites, marcos, prazos e lembretes via EventBridge Scheduler; expiração automática; limpeza de idempotency_keys (>24 h) e outbox (>7 d).
- [ ] T3.5 API: `POST/GET/PATCH /api/agreements`, `/invite`, `/cancel`, `/milestones`, `/api/templates` + OpenAPI + cliente gerado + testes IDOR.
- [ ] T3.6 Ecrãs: Dashboard, New agreement, Agreement (Terms), 4 estados cada.
- [ ] T3.7 Alarmes/runbooks: fila `pdf` parada, falha de render, schedules em falta.

**Aceitação:** formulário→pré-visualização <30 s; transições inválidas → erro de domínio.
