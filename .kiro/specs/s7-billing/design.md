# S7 — Design

## Modelo
`plans` (id, kind FREE|PER_AGREEMENT|PRO, stripe_price_id, amount_cents, monthly_quota, features jsonb, active) — editado no Admin. `entitlements` (user_id, source, kind, agreement_id?, plan_id?, valid_from, valid_until, status) — **fonte única** de direitos; `users.plan` é derivado. `purchases` (stripe_ref UNIQUE) como na sec. 6. `stripe_events` (event_id PK, type, received_at, processed_at, status) para dedupe. Quota: contagem mensal (UTC) de acordos criados vs `monthly_quota`, aplicada em `POST /api/agreements`.

## Checkout
`POST /api/billing/checkout {kind, agreement_id?}` (Idempotency-Key) cria Checkout Session (mode payment para per-agreement com `client_reference_id`/metadata; mode subscription para Pro); `customer` criado/reaproveitado. Sem `payment_method_types` fixos (métodos dinâmicos). Tax: Stripe Tax opcional via Admin (VERIFICAR requisitos/taxas).

## Webhook (`POST /api/webhooks/stripe`)
Corpo raw; `stripe.webhooks.constructEvent` com secret do Secrets Manager (tolerância 5 min); insere `stripe_events` (ON CONFLICT DO NOTHING) e enfileira SQS `stripe`; responde 200 rápido. Worker processa: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated|deleted`, `charge.refunded`/`dispute` (→ revogar entitlement futuro, nunca tocar em acordos). Reprocessável a partir do Admin. Handlers idempotentes por `event.id` e `stripe_ref`. Falha → retry → DLQ + alarme.

## Marca de água
Parâmetro de render `watermark = !entitled(agreement)` avaliado no momento da selagem; entitlement por acordo permite re-gerar o dossiê/PDF sem marca? **Decisão:** acordos já selados mantêm o selo; o utilizador paga antes de selar. (Evita reselar; simples.) Se pagar depois, emite-se novo documento selado sem marca ligado ao mesmo acordo (kind FINAL, versão de render) — configurável por flag Admin `RESEAL_AFTER_PURCHASE` (default off).

## Segurança
Chaves Stripe no Secrets Manager, escritas só pelo Admin (write-only). Modo test/live separados por ambiente.
