# S6 — Tarefas

- [x] T6.1 Página `/verify` (hash no browser) + endpoint público + rate limit + testes.
- [x] T6.2 `/.well-known/theckards-keys.json` (se não feito em S4) e página "How to verify" com guia offline.
- [x] T6.3 Dossiê ZIP assíncrono: manifesto, README, recibo próprio, `dossier_requests`, UI de pedido e link; script de verificação independente em CI.
  - ZIP determinista sem dependências (`packages/domain/src/zip.ts`), só armazenado, validado contra `zipfile` do Python e `unzip`.
  - `content_sha256` do selo = SHA-256 do `manifest.json` canónico, escrito byte a byte como foi hasheado, para `sha256sum manifest.json` dar o mesmo valor.
  - Provas incluídas até 50 MB por dossiê (memória do worker é 1 GB); acima disso ficam listadas com o hash.
  - Entitlement por plano (R-EXP-2) fica para S7: por agora é só para as partes, com limite de 2 pedidos pendentes.
- [ ] T6.4 (flag) Âncora diária Base Sepolia → Base; Merkle, `anchors`, provas nos recibos; alarmes; configuração no Admin.
- [x] T6.5 Runbooks: dossiê falhado (`dossier-failure.md`), chave pública em falta (`public-key-missing.md`). Âncora falhada fica com T6.4.

**Aceitação:** PDF alterado 1 byte recusado; dossiê auto-verificável.
