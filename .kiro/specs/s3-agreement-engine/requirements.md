# S3 — agreement-engine: Requisitos (sec. 3.2, 3.3 R-TASK, 4, 6, 8.1)

- R-AGR-1 WHEN o utilizador escolhe um modelo e preenche o formulário (≤8 campos) THEN o sistema SHALL mostrar a pré-visualização em <30 s (p95 <10 s).
- R-AGR-2 WHEN o modelo é de compra e venda THEN o formulário SHALL pedir descrição do bem, preço, forma e data de entrega e, opcionalmente, número de série/identificador.
- R-AGR-3 WHEN o criador convida a contraparte THEN o sistema SHALL enviar email com link de uso único válido 7 dias.
- R-AGR-4 WHEN os termos mudam depois de uma assinatura THEN o sistema SHALL criar nova versão, invalidar assinaturas anteriores e pedir nova assinatura.
- R-AGR-5 A máquina de estados (DRAFT, PENDING_SIGNATURES, REVISION_REQUESTED, EXECUTED, COMPLETED, IN_CASE, RESOLVED, EXPIRED, CANCELLED) SHALL viver num só módulo (`packages/domain`) e qualquer transição inválida SHALL lançar erro de domínio.
- R-AGR-6 Mutações SHALL usar `If-Match` com `version` (concorrência otimista).
- R-AGR-7 Existem exatamente três modelos: `purchase_sale`, `services`, `general`, versionados, com schema zod partilhado entre formulário e servidor; texto em inglês; aviso G4 em cada ecrã de contrato.
- R-AGR-8 Modelos personalizados e logótipo (Pro) SHALL ser opcionais e ativados por entitlement (S7); desligados até haver admin flag `CUSTOM_TEMPLATES_ENABLED`.
- R-AGR-9 Acordos PENDING_SIGNATURES sem assinatura completa passam a EXPIRED quando o convite expira (config Admin: 7 dias por defeito).
- R-TASK-1 WHEN o acordo tem marcos ou prazo THEN o sistema SHALL enviar lembretes 3 d e 1 d antes e no dia (EventBridge Scheduler). Marcos servem só para prazos e lembretes.
- R-LIM-1 Convites: 20/dia Free e 200/dia Pro (valores no Admin → Limits); corpo máx. 1 MB.

## Aceitação
Do formulário à pré-visualização <30 s; transições inválidas devolvem erro de domínio.
