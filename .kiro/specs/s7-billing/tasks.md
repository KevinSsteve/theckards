# S7 — Tarefas

- [ ] T7.1 `plans`, `entitlements`, quotas, Checkout por acordo e subscrição, Settings → Billing, pricing na landing (lê `plans`).
- [ ] T7.2 Webhook com verificação, `stripe_events`, worker idempotente, portal do cliente, reprocessamento.
- [ ] T7.3 Marca de água por plano no render.
- [ ] T7.4 Métricas de negócio (EMF) + painel (S11).
- [ ] T7.5 Testes: replay de webhooks; falha do Stripe não altera acordos; IDOR; stripe-mock em CI.
- [ ] T7.6 Runbooks: webhook falhado, divergência de entitlements.

**Aceitação:** pagar remove marca de água; webhooks repetidos não duplicam.
