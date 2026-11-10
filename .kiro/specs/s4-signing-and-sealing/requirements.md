# S4 — signing-and-sealing: Requisitos (sec. 3.2 R-SIG, 3.5 R-SEAL-1, 8.2, 8.6)

- R-SIG-1 WHEN uma parte assina THEN o sistema SHALL exigir nome completo digitado, consentimento explícito (aviso ESIGN) e código de email, e registar hora, hash do documento e evidências mínimas (IP e user agent são dados pessoais).
- R-SIG-2 WHEN as duas partes assinaram THEN o sistema SHALL gerar o PDF final, calcular SHA-256, emitir o recibo selado e enviá-lo às duas partes.
- R-SIG-3 Assinaturas de versão antiga não contam para a nova. O acordo só passa a EXECUTED quando ambas assinaram o mesmo `document_hash`.
- R-SIG-4 `signatures` é só de inserção; `UNIQUE(version_id, party_id)`; assinar duas vezes é idempotente.
- R-SEAL-1 WHEN um documento final é gerado THEN o sistema SHALL criar recibo com id, SHA-256, hora e assinatura KMS (ECDSA_P256_SHA256) sobre o JSON canónico de `id, kind, sha256, content_sha256, sealed_at`, e um QR para `/verify`.
- R-SEAL-3 Chaves públicas SHALL ser publicadas em `/.well-known/theckards-keys.json`, incluindo as antigas após rotação.
- R-SEAL-4 O PDF final SHALL incluir página de certificado (assinantes, nomes digitados, hora UTC, `content_sha256`, id do selo) e marca de água para plano Free (S7).
- R-COPY-1 A UI SHALL usar apenas as frases permitidas da sec. 8.6 / G3 e mostrar o quadro "o que o selo prova e não prova".

## Aceitação
Duas assinaturas geram PDF e recibo cuja assinatura se verifica com a chave pública.
