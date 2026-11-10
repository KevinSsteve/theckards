# S8 — launch-hardening: Requisitos (sec. 3.6, 9, 9.1, 13, 14)

- R-OPS-1 WHEN ocorre incidente grave THEN o sistema SHALL alertar o plantão em <5 min.
- R-OPS-2 SLOs: disponibilidade 99,9%; PDF <10 s em 99%; email entregue <2 min em 99%. Alarmes de burn-rate.
- R-OPS-3 Canary Synthetics a cada 5 min: criar conta de teste, gerar contrato, ver pré-visualização.
- R-OPS-4 Runbooks testados: falha de email, fila parada, falha de PDF, webhook Stripe, scan, KMS, restauro de BD.
- R-OPS-5 Teste de carga k6 a 3× o alvo cumpre os SLOs; restauro de backup com RTO e RPO medidos.
- R-A11Y-1 WCAG 2.2 AA nos fluxos principais (axe + revisão manual); LCP ≤2,5 s; JS inicial <200 KB (Lighthouse CI).
- R-SEC-3 DAST (ZAP) sem achados críticos/altos; IDOR em todas as rotas; ALB inacessível fora do CloudFront.
- R-EML-1 SES fora do sandbox, DKIM, SPF, DMARC; bounces/complaints tratados automaticamente (supressão).
- R-LEG-6 Build de produção SHALL falhar (e a app em prod SHALL recusar arrancar o fluxo de registo) enquanto algum texto legal estiver RASCUNHO.
- R-ABU-1 Anti-abuso: limites, regras de taxa no WAF, bot control no registo, botão de denúncia, suspensão de contas.
- R-PRV-1 Privacidade: só cookies essenciais, sem analytics que enviem conteúdo; logs sem PII; retenção de logs 90 d; política de retenção por categoria (sec. 9.1) aplicada por jobs configuráveis; Bedrock: rever termos de retenção/treino antes do go-live.
- R-COST-1 Custo por acordo medido; budgets e anomalias ativos.
- R-REL-1 Lista de lançamento (sec. 13) preenchida e go-live.

## Aceitação
Todos os pilares da lista de lançamento verificados com evidência anexada em `docs/launch-checklist.md`.
