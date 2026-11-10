# S5 — Tarefas

- [x] T5.1 Uploads: presign assinado por tipo e tamanho, bucket de quarentena, GuardDuty Malware Protection for S3 em modo independente (ADR-020), verificação de magic bytes, hash, API + UI Evidence. Miniaturas sem metadados ficam adiadas: exigem biblioteca nativa na imagem do worker (decisão separada).
- [x] T5.2 Mensagens imutáveis + UI Messages (no Record). Notificações por email ficam atrás de `EMAIL_DELIVERY_ENABLED` (desligado na fase 1); por agora são visíveis na página do acordo.
- [x] T5.3 Casos, propostas (substituição automática), aceitação pela outra parte, Adenda de Resolução assinada pelas duas contas e selada (`kind=ADDENDUM`); retirada pelo autor; UI Case. Janela de provas de 7 dias só informativa (sem agendamento: nada acontece automaticamente).
- [x] T5.4 Confirmações por parte/tipo, resultado derivado, COMPLETED (`milestones` já nasceu sem `done_by_*`). Emails de 3 ações adiados com o email (fase 1).
- [x] T5.5 Notas ao registo (R-NOTE-1); inclusão no dossiê fica para S6.3.
- [x] T5.6 Testes de propriedades (isolada≠MUTUAL; ordem; silêncio) + IDOR por rota nova + testes de que nenhum texto implica decisão/garantia (G2/G3).
- [x] T5.7 Alarmes/runbooks: estado do plano de malware (Warning/Error) para o tópico de alertas, DLQ existente, e `docs/runbooks/evidence-scanning.md` para scan parado e ficheiros infetados.

- [x] T5.0 (novo) Papéis explícitos nos modelos (vendedor/comprador, prestador/cliente) e acesso duradouro da contraparte presencial (ligação a conta via `/claim`).

**Aceitação:** caso completo termina em adenda selada ou retirada.
