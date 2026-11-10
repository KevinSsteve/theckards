# S4 — Tarefas

- [ ] T4.1 Migrações `signatures`, `sealed_documents`, `audit_logs`, `user_consents`; triggers/grants só-inserção; endpoints `/otp` e `/sign` (user e guest); UI de assinatura.
- [ ] T4.2 Worker `seal.final`: PDF final + certificado + QR + KMS Sign + recibo; chaves públicas e `/.well-known/theckards-keys.json`.
- [ ] T4.3 Emails de convite/recibo (templates EN, SES, configuration set), invalidação de assinaturas em nova versão (R-AGR-4/R-SIG-3).
- [ ] T4.4 Testes: assinatura de versão antiga não conta; idempotência; verificação da assinatura com chave pública; IDOR; sem PII em logs.
- [ ] T4.5 Runbooks: falha de selagem, KMS indisponível, rotação de chave.

**Aceitação:** duas assinaturas → PDF + recibo verificável com a chave pública.
