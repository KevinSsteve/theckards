# S6 — verify-and-dossier: Requisitos (sec. 3.5, 8.3–8.5)

- R-VER-1 WHEN alguém carrega um PDF ou cola um hash em `/verify` THEN o browser SHALL calcular o SHA-256 (WebCrypto) e o sistema SHALL indicar se corresponde a um selo, mostrando só validade, tipo, data, id e existência de âncora; nunca nomes ou dados das partes.
- R-VER-2 `GET /api/public/verify/{sha256}` SHALL ser público, sem PII, com rate limit e cache curto; resposta idêntica para inexistente vs. formato inválido não deve permitir enumeração útil.
- R-VER-3 Página "How to verify" com verificação offline do recibo.
- R-EXP-1 WHEN uma parte pede o dossiê THEN o worker SHALL gerar ZIP com PDF selado, JSON, histórico de versões, registo de assinaturas, mensagens, provas com índice, propostas do caso, confirmações, notas, recibos, `manifest.json` de hashes e README de verificação; guardado no S3; link temporário de 24 h; com recibo selado próprio (kind DOSSIER).
- R-EXP-2 Dossiê SHALL estar disponível apenas para partes do acordo e conforme entitlement (Por acordo/Pro).
- R-SEAL-2 (flag `ANCHOR_ENABLED`, desligada) WHEN passa um dia THEN o sistema SHALL ancorar na Base (testnet Sepolia primeiro) a raiz de Merkle dos selos do dia e acrescentar prova de inclusão; só hashes, gas do Theckards (G8).

## Aceitação
PDF alterado em 1 byte é recusado; dossiê verifica-se sozinho com o README.
