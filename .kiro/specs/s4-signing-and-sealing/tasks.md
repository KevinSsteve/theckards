# S4 — Tarefas

- [x] T4.1 Migração 0004: `signatures`, `party_consents`, `sealed_documents` (só inserção: triggers + REVOKE); endpoints `/otp` e `/sign` (criador) e `/api/guest/{token}/otp|complete` (convidado, sem conta); UI de assinatura partilhada (`SignForm`).
- [x] T4.2 Worker `seal.final`: PDF final determinístico com página de certificado, QR e marca de água Free; KMS `Sign` ECDSA P-256 sobre JSON canónico; `/.well-known/theckards-keys.json`.
- [x] T4.3 Emails: código (`email.otp`), recibo com PDF + `receipt.json` anexos (`email.receipt`), pedido de alterações (`email.revision_requested`). Assinaturas de versões antigas não contam (validade por `version_id`).
- [x] T4.4 Testes: PDF final byte-idêntico em retries; hash muda com 1 carácter; verificação ECDSA offline e rejeição de adulteração; injeção de cabeçalhos MIME; contratos de rotas de convidado. Verificado em produção: assinatura KMS real valida com a chave publicada.
- [x] T4.5 Runbooks: `seal-failure.md`; ADR-017.

## Pendente / dependências externas
- Teste end-to-end com emails reais: bloqueado pelo **SES sandbox** (só entrega a endereços verificados) e pelos **textos legais em DRAFT** (assinatura devolve 503 até aprovação no Admin).
- Rotação de chave: `SEAL_PUBLIC_KEY_ARNS` adicionais ainda não parametrizados no CDK (só a chave v1 existe).
- Expiração automática de convites (R-AGR-9) e lembretes (R-TASK-1) continuam em S3/T3.4.

**Aceitação:** duas assinaturas → PDF + recibo verificável com a chave pública. Cadeia KMS → chave pública confirmada em produção; fluxo completo aguarda SES + aprovação legal.
