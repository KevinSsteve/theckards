# S5 — Tarefas

- [ ] T5.1 Uploads: presign, quarentena, GuardDuty Malware Protection (ou fallback por ADR), hash, miniaturas, timeline; API + UI Evidence.
- [x] T5.2 Mensagens imutáveis + UI Messages (no Record). Notificações por email ficam atrás de `EMAIL_DELIVERY_ENABLED` (desligado na fase 1); por agora são visíveis na página do acordo.
- [ ] T5.3 Casos, propostas, Adenda de Resolução assinada e selada; retirada do caso; UI Case.
- [x] T5.4 Confirmações por parte/tipo, resultado derivado, COMPLETED (`milestones` já nasceu sem `done_by_*`). Emails de 3 ações adiados com o email (fase 1).
- [x] T5.5 Notas ao registo (R-NOTE-1); inclusão no dossiê fica para S6.3.
- [ ] T5.6 Testes de propriedades (isolada≠MUTUAL; ordem; silêncio) + IDOR + testes de que nenhum texto implica decisão/garantia (G2/G3).
- [ ] T5.7 Alarmes/runbooks: scan parado, DLQ de emails, uploads infetados.

- [x] T5.0 (novo) Papéis explícitos nos modelos (vendedor/comprador, prestador/cliente) e acesso duradouro da contraparte presencial (ligação a conta via `/claim`).

**Aceitação:** caso completo termina em adenda selada ou retirada.
