# S4 — Design

## Assinar (`POST /api/agreements/{id}/sign`)
Transação serializável: valida sessão (user/guest), OTP verificado (<10 min), `version_id` = versão corrente, consentimento ESIGN com versão APROVADA, nome digitado ≥ 2 palavras. Insere `signatures` (+ `user_consents`). Se ambos assinaram o mesmo hash → transição `EXECUTED` + outbox `seal.final`.

## Selagem (worker `seal.final`)
1. Carrega versão e assinaturas; renderiza PDF final (contrato + certificado + QR) de forma determinística; 2. SHA-256; 3. `kms:Sign` (MessageType DIGEST, ECDSA_SHA_256) sobre SHA-256 do JSON canónico; 4. insere `sealed_documents` (sha256 UNIQUE, kms_key_id, signature); 5. grava recibo JSON no S3; 6. outbox `email.receipt` às duas partes (links de download assinados, curta duração); 7. agenda lembretes.
Idempotente por (agreement_id, version_id, kind). Falha → retry com backoff → DLQ + alarme.

## Chaves
`GET /.well-known/theckards-keys.json`: `[{key_id, alg, public_key_pem, not_before, retired_at?}]` obtido de `kms:GetPublicKey`, cache em CloudFront 1 h. Rotação por novo alias; nunca remover chaves antigas. Página "How to verify" inclui exemplo offline (openssl/Node) .

## UI
Passo de assinatura: resumo, aviso G4, retenção (R-LEG-3), caixa ESIGN, nome, OTP; duplo-clique protegido. Estado "Waiting for the other party". Página Guest signing sem conta.

## Segurança
`seal-key` com policy: só a role do worker tem `kms:Sign`; web só `GetPublicKey`. Auditoria CloudTrail. `audit_logs` encadeado (hash anterior) com escrita serializada (advisory lock).
