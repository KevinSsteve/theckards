# S10 — Design

- **Dados**: `profiles`, `agreement_flags` (sec. 17.6), `profile_stats_cache(user_id, computed_at, payload jsonb)` — cache derivado, regenerável, nunca editável pela API.
- **Cálculo**: funções SQL/consultas determinísticas sobre `agreements`, `signatures`, `confirmations` (via `outcome` do domínio) excluindo agreements com flag. Job diário (EventBridge) + recálculo sob pedido limitado a 1×/dia. `Different counterparties` = contas distintas dos acordos contados.
- **Regras F1–F5**: `packages/domain/fraud.ts` (funções puras + testes); F1 na criação de acordo (erro de domínio); F2/F3/F5 em job incremental e após eventos; limiares lidos de `app_settings.fraud`.
- **Páginas**: `/p/{handle}` SSR com `X-Robots-Tag: noindex` + meta; 404 se privado/inexistente; cache CloudFront ≤60 s e invalidação ao desativar (garante ≤5 min). `/trust/how-it-works` estático.
- **Convidado**: se criador público, o resumo aparece na página de assinatura (R-PROF-5).
- **Copy lint**: teste que varre o copy deck por frases proibidas (sec. 17.5) e falha o build.
- **Privacidade**: eliminação de conta remove perfil; sem listas de acordos na API pública (teste de contrato).
