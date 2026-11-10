# S9 — ai-contract-assistant: Requisitos (sec. 15, G9, G10)

- R-AI-1 WHEN o utilizador escreve uma descrição (≤2000 chars) e escolhe um modelo THEN o sistema SHALL devolver campos sugeridos, em falta e avisos em <20 s, ou o formulário manual se a IA estiver indisponível.
- R-AI-2 O sistema SHALL NOT gerar nem alterar texto jurídico: a IA só preenche campos do schema.
- R-AI-3 WHEN a IA devolve um valor THEN o sistema SHALL marcá-lo "Suggested by AI", exigir confirmação e verificar que números e datas derivam do texto (senão `needs_confirmation`).
- R-AI-4 O sistema SHALL limitar gerações por utilizador (10 Free / 100 pago por dia) e por IP, e permitir desligar a IA por flag sem deploy.
- R-AI-5 WHEN o modelo principal falha ou excede o timeout (20 s) THEN SHALL usar o fallback e depois o formulário manual, sem nunca bloquear o utilizador.
- R-AI-6 SHALL mascarar emails, telefones e identificadores antes de enviar ao modelo e NÃO guardar texto livre nem respostas; só metadados em `ai_generations`.
- R-AI-7 Cada ecrã com sugestões mostra "Review before signing. Not legal advice."
- R-AI-8 Todos os parâmetros (modelo, fallback, timeout, max tokens, limites, enabled) SHALL ser configuráveis no Admin → AI, validados, com auditoria.
- R-AI-9 Nada é assinado nem enviado sem ação explícita do utilizador.

## Aceitação
Descrição→formulário <20 s (meta 10 s); zero valores inventados nos evals; IA desligada/falha → criação manual funciona.
