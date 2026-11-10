# S9 — Tarefas

- [ ] T9.1 Bedrock: ler docs atuais (model access, IDs, regiões, inference profiles, retenção/treino); IAM mínimo, VPC endpoint, AppConfig + `app_settings.ai`.
- [ ] T9.2 `POST /api/agreements/ai-fill`: mascaramento, Converse c/ ferramenta forçada, zod, timeout, fallback, verificação determinística.
- [ ] T9.3 UI: caixa de texto, loading, chips, confirmação, em falta, aviso.
- [ ] T9.4 Limites diários, flag, `ai_generations`, métricas, alarmes, Budget de IA.
- [ ] T9.5 Evals (30 casos); medir custo/latência de Opus/Sonnet/Haiku 5.5; aplicar regra da sec. 15.2 (p95 >20 s ou >US$0,10 → trocar default).
- [ ] T9.6 Testes de prompt injection e "não inventar valores"; teste de que texto livre nunca é persistido (nem em logs).

**Aceitação:** <20 s; zero inventados; IA desligada/falha → manual OK.
