# S3 — Design

## packages/domain
- `state-machine.ts`: tabela de transições imutável; `transition(state, event)` lança `InvalidTransitionError`. Enums de estados exportados e usados para gerar os `CHECK` das migrações.
- `templates/{purchase_sale,services,general}/v1.ts`: `{id, version, title, fields[], zodSchema, render(fields) → blocos}`. Texto jurídico só aqui (G9).
- `canonical.ts`: JSON canónico (RFC 8785 JCS) para hashing.
- Testes de propriedades (fast-check): nenhuma sequência de eventos chega a estado inválido; terminais não saem.

## Geração de PDF (worker, ADR-005)
`pdf-lib` + fontes embutidas (Noto Sans subset), metadados fixos (CreationDate/ModDate fixos = `created_at` da versão, Producer constante, sem ID aleatório) → mesmo conteúdo, mesmo hash. `content_sha256` = SHA-256 do PDF de pré-visualização/versão. Pré-visualização síncrona-com-fila: web publica job, UI faz polling/SSE até pronto; meta p95 <10 s. Marca de água só no PDF final por entitlement (S7).

## Fluxo de dados
`POST /api/agreements` → tx: agreements(DRAFT) + agreement_versions(1, fields) + outbox(`pdf.render`) → worker renderiza, grava no S3 (`agreements/{id}/v{n}.pdf`, SSE-KMS), atualiza `document_s3_key`, `document_sha256`. `PATCH` com `If-Match` cria versão n+1, marca assinaturas anteriores como não aplicáveis (sem apagar; só inserção — validade determinada por `version_id == current_version`).

## Outbox
Publisher no worker (poll `FOR UPDATE SKIP LOCKED`) → SQS; consumidores idempotentes por `outbox.id`.

## Lembretes
Ao passar a EXECUTED ou ao criar marco/prazo: criar schedules one-time no EventBridge Scheduler (`reminder-{agreementId}-{t}`) para T-3d, T-1d, T0 → target SQS `reminders`. Cancelamento/atualização ao mudar prazo. Reconciliação diária (job) corrige schedules em falta.

## Convites
Token 256 bit; guarda-se hash; email SES com link `/g/{token}`; expiração 7 d (config). Reenvio gera novo token e invalida o anterior.

## UI
Wizard New agreement: modelo → formulário (≤8 campos) → pré-visualização (iframe/pdf.js lazy) → assinatura (S4) → convite. Dashboard por estado, prazos, quota. Orçamento JS <200 KB inicial.
