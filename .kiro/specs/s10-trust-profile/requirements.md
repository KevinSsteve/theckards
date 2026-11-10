# S10 — trust-profile (M5, só após go-live): Requisitos (sec. 17.3, 17.4, 17.7, G11)

- R-PROF-1 Perfil privado por defeito; só o titular o torna público.
- R-PROF-2 Perfil público mostra apenas: nome a mostrar, "Email verified" (data), "Member since", cinco números (Agreements signed by both parties, Confirmed by both parties, One-sided confirmation, No confirmation recorded, Different counterparties) e link "How are these numbers calculated?". Sem estrelas, pontuações, rankings, texto livre sobre terceiros, lista de acordos ou identidade de contrapartes; casos abertos não aparecem.
- R-PROF-3 Números calculados só a partir dos registos, atualizados no máximo 1×/dia, cada um com definição.
- R-PROF-4 WHEN o titular desativa o perfil THEN a página SHALL devolver 404 em ≤5 min.
- R-PROF-5 WHEN o convidado abre um convite e quem convidou tem perfil público THEN a página de assinatura SHALL mostrar o resumo e o aviso fixo.
- R-PROF-6 A UI SHALL usar apenas as frases permitidas da sec. 17.5 (verificação automática de frases proibidas).
- R-PROF-7 Handle `^[a-z0-9_]{3,30}$`, display name ≤60; página com `noindex`; aviso fixo: "These numbers come from records made on Theckards. They are not a guarantee, a rating or a verification of identity."
- R-PROF-8 Flag `PUBLIC_PROFILE_ENABLED` (Admin) desligada até M5.
- R-FRAUD-1 Bloquear acordos entre contas com o mesmo email normalizado (F1; minúsculas, sem +tag, sem pontos Gmail).
- R-FRAUD-2 Aplicar F2 (>3 acordos mesmo par), F3 (>10 acordos/24 h), F5 (≥5 confirmações <60 s após assinatura) de forma determinística; registar flag com motivo; excluir dos números; mostrar motivo ao titular (`GET /api/me/flags`). F4: conta <7 dias → "New account".
- R-FRAUD-3 Flags individuais nunca são públicas; a página diz apenas que acordos sinalizados por regras automáticas não são contados.
- Limiares F2/F3/F5 configuráveis no Admin (defaults acima); revisão com dados reais após 1 mês.

## Aceitação
Privado por defeito; números não editáveis à mão; declaração isolada nunca aparece como transação concluída.
