# S10 — Tarefas (após go-live)

Estado: a base está feita (dados, regras puras, F1 em produção, lint de frases). A página pública e o cálculo
diário ficam para M5, quando o dono ligar `PUBLIC_PROFILE_ENABLED`; até lá nada disto é visível.

- [~] T10.1 `profiles`, definições do utilizador, flag `PUBLIC_PROFILE_ENABLED` (Admin).
  - Feito: tabelas `profiles` (privado por defeito, `is_public` default false), `agreement_flags`,
    `profile_stats_cache` (migração 0014); chave `fraud` em `app_settings` + registry do Admin.
  - Falta: ecrã de definições do titular (escolher handle, tornar público).
- [~] T10.2 Cinco números por consultas determinísticas, cache diária, página de definições.
  - Feito: `profileCounts` + `PROFILE_NUMBERS` com definição por número (`packages/domain/src/profile.ts`).
  - Falta: consultas SQL que alimentam os registos, job diário, página `/trust/how-it-works`.
- [ ] T10.3 `/p/{handle}` com noindex, aviso fixo, 404 se privada; invalidação CloudFront.
- [~] T10.4 Regras F1–F5, `agreement_flags`, vista do titular, contestação por suporte (Admin).
  - Feito: F1–F5 como funções puras (`packages/domain/src/fraud.ts`), limiares configuráveis, e **F1 aplicado
    em produção** nos dois pontos onde os dois lados se encontram: convite por email e `/claim`. Antes só se
    comparava o email exato, pelo que `alex+x@gmail.com` e `a.l.e.x@gmail.com` passavam como pessoas diferentes.
  - Falta: job que grava F2/F3/F5 em `agreement_flags`, `GET /api/me/flags`, contestação.
- [ ] T10.5 Resumo do perfil na página de assinatura do convidado.
- [~] T10.6 Testes: flagged nunca conta; números = registos; copy lint de frases proibidas; IDOR.
  - Feito: 1 agreement sinalizado não move nenhum número (nem contrapartes distintas); lint de frases com
    exceção para o aviso obrigatório, que tem de conter as palavras que nega; F1 no `/claim`.
  - Falta: IDOR da página pública (só existe em M5).

**Aceitação:** conforme requirements.md.
