# S5 — Design

## Uploads
`POST /evidence` valida tipo/tamanho declarados, cria `evidence` (scan_status=PENDING) e devolve URL pré-assinado PUT (bucket `evidence-quarantine`, condições content-length-range ≤25 MB, content-type permitido, SSE-KMS). Cliente chama `/complete`. Scan: **GuardDuty Malware Protection for S3** no bucket de quarentena (VERIFICAR doc atual e custos; fallback ClamAV em Fargate — ADR) → EventBridge → worker: se limpo, valida magic bytes, calcula SHA-256, copia para bucket `evidence` (versionado), gera miniatura sem EXIF (sharp), `scan_status=CLEAN`; se infetado, `INFECTED`, objeto removido, utilizador notificado. Evidência só visível quando CLEAN. `s3_version_id` guardado.

## Mensagens/notas
Tabelas `messages`, `record_notes`: grants só INSERT/SELECT. Notificação por outbox `email.message` com agregação (máx. 1 email/10 min por acordo) para evitar spam.

## Confirmações
`packages/domain/confirmations.ts`: `expectedPairs(templateId, hasPayment)` e `outcome(confirmations, dueAt, now)` → `MUTUAL|ONE_SIDED|NONE|PENDING` (puro, testado com fast-check). Ao registar: insere, avalia; se MUTUAL e estado EXECUTED → transição COMPLETED. Email com 3 ações (links assinados de uso único: confirm / open case / ignore — ignore não grava nada). Tabela `confirmations` UNIQUE(agreement, party, kind).
Migração: `ALTER TABLE milestones DROP COLUMN done_by_*` (expand/contract: a criação de milestones em S3 já nasce sem essas colunas).

## Casos
Estado do acordo EXECUTED→IN_CASE; `cases` (UNIQUE agreement), `proposals` (supersede automático da anterior da mesma parte). Aceitação por ambas → worker `seal.addendum` (PDF da adenda com corpo da proposta + ambas assinam com OTP, reutilizando fluxo S4 `kind=ADDENDUM`) → RESOLVED. Janela de provas: schedule EventBridge 7 d (apenas informativo; não decide nada). UI Case: provas, propostas, adenda; copy neutro (G2).

## Linha cronológica
View/consulta `timeline(agreement_id)` união de versões, assinaturas, mensagens, provas, confirmações, notas, eventos de caso; paginada por cursor.
