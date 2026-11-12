# S8 — Tarefas

- [ ] T8.1 Domínio, HSTS, SES (DKIM/SPF/DMARC), pedido de saída do sandbox, supressão de bounces.
- [~] T8.2 Canary, RUM, SLOs, alarmes e runbooks essenciais; destinos de alerta configuráveis; painel de custo por acordo.
  - Feito: os 10 alarmes passam a chegar a uma pessoa (o tópico não tinha subscritores); verificação externa de
    disponibilidade com Route 53 em vez de canary Synthetics ([ADR-021](../../../docs/adr/021-external-availability-check.md));
    tags em todos os recursos e orçamento de uso bruto a US$200 ([ADR-022](../../../docs/adr/022-cost-attribution-and-budget.md)).
  - Feito (R-OPS-2, parcial): SLO de disponibilidade 99,9% e de preview PDF <10 s em 99%, ambos com
    janelas 5m/1h a 14,4× e 30m/6h a 6×, composites, heartbeat do publicador e dashboard; fonte PDF
    deduplicada na BD, sem PII ([ADR-023](../../../docs/adr/023-slos-and-burn-rate.md)).
  - Falta: SLO de email (a flag continua desligada e não há eventos `Delivery` sanitizados), RUM, destinos de
    alerta no Admin, custo por acordo (precisa de um mês de custos com tags).
- [~] T8.3 k6 a 3×; restauro de backup com RTO/RPO medidos; failover testado se Multi-AZ for adotado por ADR.
  - Feito: restauro PITR medido em produção, 23 min 42 s e zero perda ([ADR-009](../../../docs/adr/009-rto-rpo.md)).
  - Falta: k6; ensaio do corte (cutover) para a instância restaurada.
- [~] T8.4 axe + manual, Lighthouse CI, ZAP, suíte IDOR completa.
  - Feito: axe-core 4.14.0 em 18 estados de página, zero violações; verificação manual de foco, contraste,
    reflow, títulos e sessão expirada, com defeitos corrigidos e presos por testes; LCP e JS inicial medidos com o
    perfil de throttling do Lighthouse ([accessibility](../../../docs/accessibility.md)). Suíte IDOR: o gate de
    build já exige um teste de outsider por módulo autorizado por `member()`.
  - Feito (ZAP): scan passivo à produção com ZAP 2.17.0, High 0 / Medium 0 / Low 0 em `a40276b`, quatro achados
    informativos triados. O primeiro scan encontrou a falta de Content-Security-Policy; todas as respostas HTML,
    404 incluídos, têm agora uma política com nonce por pedido, sem `'unsafe-inline'` nem `'unsafe-eval'`,
    verificada no Chrome em páginas públicas e autenticadas ([security-scan](../../../docs/security-scan.md)).
  - Falta: leitor de ecrã (NVDA/VoiceOver), automatizar a auditoria e o scan após cada deploy, scan ativo e
    autenticado (precisam de staging).
- [ ] T8.5 Gate de build contra RASCUNHO; aprovação dos textos pelo dono no Admin → Legal.
- [~] T8.6 Retention sweeper; denúncias/suspensão; revisão Bedrock (retenção/treino) refletida na Privacy Policy.
  - Feito: sweeper no worker (`apps/worker/src/retention.ts`), só sobre dados operacionais (sessões, chaves de
    idempotência, eventos de rate limit, OTP, outbox publicada, ledger de jobs); nunca sobre o registo, e os grants
    da BD impedem-no mesmo que tentasse. Janelas presas por testes ao código de que dependem. Alarme + runbook.
  - Falta: denúncias/suspensão (S11 T11.7); revisão Bedrock (bloqueada: sem acordo de modelo na conta).
- [ ] T8.7 `docs/launch-checklist.md` com evidências; go-live.

**Aceitação:** checklist da sec. 13 integralmente verde.
