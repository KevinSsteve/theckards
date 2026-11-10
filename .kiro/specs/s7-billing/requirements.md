# S7 — billing: Requisitos (sec. 2, 3.6 R-BIL)

- R-BIL-1 WHEN o utilizador excede a quota gratuita THEN o sistema SHALL oferecer pagar por acordo ou subscrever o Pro (Stripe Checkout), com webhooks idempotentes.
- R-BIL-2 WHEN chega um webhook do Stripe THEN o sistema SHALL validar assinatura e timestamp, processá-lo de forma idempotente e atualizar `entitlements`, sem confiar apenas no redirect de sucesso.
- R-BIL-3 WHEN o Stripe falha THEN acordos assinados SHALL permanecer intactos: falha de cobrança nunca corrompe, altera ou apaga um acordo.
- R-BIL-4 Planos e quotas (Free 2/mês c/ marca de água; Por acordo US$4,99; Pro US$19/mês, 30 acordos/mês, logótipo, modelos personalizados, suporte prioritário) SHALL ser configuráveis no Admin (Stripe Prices referenciados por id); nenhum plano promete prazos de retenção.
- R-BIL-5 Marca de água SHALL ser aplicada no recibo/PDF final conforme entitlement; pagar remove-a para novos selos.
- R-BIL-6 Portal do cliente Stripe para gerir subscrição e faturas.
- R-BIL-7 G1/G5: nenhum dado de cartão/IBAN passa pelo Theckards; só Stripe Checkout hospedado; Stripe nunca toca em dinheiro entre as partes.
- R-BIL-8 Métricas: acordos criados, % assinados por ambos, conversão Free→pago, receita por acordo, custo por acordo.

## Aceitação
Pagar remove marca de água; webhooks repetidos não duplicam compras nem direitos.
