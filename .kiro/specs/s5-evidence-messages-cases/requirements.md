# S5 — evidence-messages-cases: Requisitos (sec. 3.3, 3.4, 17.2, 17.7)

- R-EVD-1 WHEN uma parte carrega prova (imagem ou PDF, ≤25 MB) THEN o sistema SHALL verificar tipo, procurar malware, calcular hash e acrescentá-la à linha cronológica.
- R-EVD-2 Provas SHALL ser imutáveis: só acrescentar.
- R-EVD-3 Uma prova SHALL só ficar visível após scan limpo; original intacto, miniaturas sem metadados.
- R-MSG-1 WHEN uma parte envia mensagem (≤4000 chars) THEN o sistema SHALL guardá-la de forma imutável e notificar a outra por email.
- R-DSP-1 WHEN uma parte abre um caso THEN o sistema SHALL congelar os termos, abrir janela de provas de 7 dias e notificar a outra parte.
- R-DSP-2 WHEN ambas aceitam uma proposta THEN o sistema SHALL gerar e selar uma Adenda de Resolução assinada pelas duas.
- R-DSP-3 O sistema SHALL NOT decidir o resultado nem mover fundos (G1, G2).
- R-DSP-4 Caso pode ser retirado → acordo volta a EXECUTED.
- R-CONF-1 WHEN uma parte regista uma confirmação THEN o sistema SHALL guardá-la só-inserção (acordo, parte, tipo, hora, nota ≤500) e notificar a outra parte com opções confirmar / abrir caso / ignorar.
- R-CONF-2 Um só lado de um par SHALL aparecer como "declared by X, waiting for Y", nunca concluído.
- R-CONF-3 O acordo passa a COMPLETED apenas quando todos os pares esperados do modelo existem nos dois lados (pares de pagamento só se o acordo envolve pagamento).
- R-CONF-4 O silêncio não é confirmação nem incumprimento; ausência mostra "No confirmation recorded" (NONE só após prazo + 14 dias; antes "pending").
- R-CONF-5 Confirmações de pagamento são declarações; UI diz "declared by"; nunca verificadas/processadas/garantidas (G1, G5).
- R-NOTE-1 Notas ≤500 chars, só-inserção, visíveis às duas partes, incluídas no dossiê, nunca públicas.
- Resultado MUTUAL/ONE_SIDED/NONE derivado por consulta, nunca guardado.
- Colunas `done_by_*` de `milestones` removidas (substituídas por `confirmations`).

## Aceitação
Um caso completo termina com adenda selada ou retirada, sem decisão da plataforma. Teste de propriedades: confirmação isolada nunca dá MUTUAL; ordem irrelevante; silêncio nunca conta.
