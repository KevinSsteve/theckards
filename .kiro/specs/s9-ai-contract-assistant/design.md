# S9 — Design

## Config (via S11)
`app_settings.ai = {provider:'bedrock', modelId, fallbackModelId, timeoutMs, maxOutputTokens, dailyLimitFree, dailyLimitPaid, enabled}` espelhado em AppConfig (flag `AI_ENABLED`). Defaults do guião (`anthropic.claude-opus-5-5`, `anthropic.claude-sonnet-5-5`, 20000, 1500, 10, 100). **IDs, região e inference profiles NÃO verificados**: T9.1 consulta a documentação do Bedrock e o Admin valida o ID chamando `GetFoundationModel`/um ping barato antes de gravar.

## Pipeline (`apps/web/src/server/ai/fill.ts`)
1. `withRoute` (auth, rate limit por user/IP, quota diária em `ai_generations`).
2. `mask(text)`: regex + libs (emails, telefones E.164/US, SSN, cartões Luhn, URLs, IDs longos) → marcadores `[EMAIL_1]`. Mapa só em memória do request.
3. `BedrockRuntimeClient.converse` com `toolConfig.tools=[fill_fields]`, `toolChoice:{tool:{name:'fill_fields'}}`; `inputSchema` gerado de zod (zod-to-json-schema); system prompt da sec. 15.3; texto do utilizador em bloco delimitado como dados. Parâmetros de raciocínio/esforço conforme suporte do modelo (VERIFICAR). `AbortSignal` com timeout.
4. Validação zod; 1 retry; fallback model; senão `{status:'MANUAL'}`.
5. Verificação determinística: extrai números/datas do texto original (normalização: "$400", "four hundred", "Friday"→ data resolvida com `today`+TZ) e compara; divergência → `needs_confirmation`.
6. Resposta `{fields, missing[], warnings[], needs_confirmation[]}`; desmascara marcadores só no cliente se necessário (preferível não desmascarar: campos de identidade vêm do formulário).
7. Insere `ai_generations` (modelo, tokens, latência, estado, custo estimado com preços em `app_settings.ai.prices`).

## IAM / rede
Role da task `web` com `bedrock:InvokeModel` (+`InvokeModelWithResponseStream` se usado) restrita aos ARNs de modelo/inference profile configurados (parametrizados no CDK a partir de valor semente; atualização via Admin exige redeploy de policy → **ADR**: usar padrão `arn:...:foundation-model/anthropic.*` + `inference-profile/*` limitado à conta, e validação de allow-list na app). VPC endpoint `bedrock-runtime`.

## Evals
`packages/domain/ai-evals/` 30 casos EN (campos esperados, inventados proibidos); runner contra Bedrock real em CI manual/nightly + mock em PR; métricas: % corretos, zero inventados, p95. Testes de prompt injection.

## UI
Textarea (2000), loading, chips "Suggested by AI", lista de em falta com perguntas, confirmação por campo, aviso fixo; botão "Fill manually" sempre disponível.

## Observabilidade
EMF: `ai_requests`, `ai_latency_ms`, `ai_fallback_rate`, `ai_invalid_output_rate`, `ai_cost_est`; alarmes + AWS Budget específico (tag `feature=ai`).
