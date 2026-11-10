# S2 — Design

## Cognito (Essentials)
User pool com email (login) + IdP Google (client id/secret no Secrets Manager, definidos pelo Admin → Integrations; CDK lê o secret). Hosted UI/managed login com PKCE; BFF faz code exchange no servidor. Grupo `admins`, MFA TOTP obrigatório para o grupo (verificar na doc atual como impor MFA por grupo; fallback: MFA obrigatório no pool). Pre-sign-up/post-confirmation Lambda **evitada**: criação do `users` no primeiro callback do BFF (simples).

## Sessão BFF
Tabela `sessions` (id hash, user_id, kind USER|ADMIN|GUEST, created_at, last_seen_at, absolute_expires_at, refresh token cifrado com KMS). Cookie `__Host-dk_session` opaco. CSRF: double-submit token + verificação de Origin. Refresh do Cognito apenas no servidor.

## Guest
`parties.invite_token_hash` (SHA-256 de token 256 bits), `invite_expires_at`. Fluxo: GET `/api/guest/{token}` → dados mínimos do acordo; POST `/otp` envia código SES; verificação cria sessão GUEST 2 h ligada a (agreement_id, party_id). Email do convidado cifrado em coluna (KMS data key via envelope; `email_hash` HMAC para lookup). Job apaga o email do convite após expirar/assinar.

## OTP
Tabela `otp_codes` (scope, subject_hash, code_hash, expires_at, attempts, ip_hash). Rate limit na BD (contagem por janela) + regras WAF.

## Consents / legal
`legal_documents(type, version, status DRAFT|APPROVED|RETIRED, locale, body_md, approved_by, approved_at)`. `user_consents` conforme sec. 6. Middleware `requireLegalAccepted`.

## Eliminação/export
`DELETE /api/me` cria job no worker: anonimiza `users`, remove perfil, apaga convites; mantém registos de assinatura/recibos de acordos existentes conforme sec. 9.1 e devolve ao utilizador lista do que fica e porquê. Export: JSON + ZIP assíncrono, link 24 h.

## Cross-cutting (`apps/web/src/server`)
`withRoute({auth, authz, schema, rateLimit, idempotent})` wrapper obrigatório; lint rule proíbe route handlers sem ele. Teste de IDOR gerado a partir do OpenAPI (`api/openapi.yaml`) percorre todas as rotas com tokens de utilizadores A/B/guest/admin.
