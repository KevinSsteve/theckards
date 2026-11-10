# Theckards v1

Camada de confiança para acordos entre pessoas que já decidiram negociar: contrato em menos de 30 s, assinatura, provas, confirmações por parte, selo verificável e dossiê. Produção nos EUA, na AWS.

## Guardrails (inegociáveis)
- G1 Nunca receber, reter, converter ou transmitir dinheiro das partes, nem cripto. Sem carteiras nem saldos.
- G2 Nunca decidir quem tem razão num caso. A adenda só existe se as duas partes a aceitarem.
- G3 Sem promessas de garantia, proteção de pagamento ou validade jurídica. Usar "verifiable record", "integrity receipt", "recorded electronic signature".
- G4 Sem aconselhamento jurídico. O formulário só preenche um modelo; aviso visível em cada ecrã de contrato.
- G5 Nenhum dado de pagamento das partes (IBAN, cartão). Só o Stripe cobra o Theckards.
- G6 Fora do v1: pseudónimos, IMEI, NFTs, KYC, escrow, USDC, keeper, indexador, arbitragem.
- G7 Se tocar em fundos: parar.
- G8 Âncora blockchain só publica hashes, só gasta gas do Theckards, atrás de flag (desligada).
- G9 A IA só preenche campos do schema. Nunca escreve cláusulas, nunca assina, nunca decide casos.
- G10 A IA só recebe texto mascarado + schema. Texto livre nunca é guardado.
- G11 Sem pontuações, estrelas, rankings ou rótulos sobre pessoas; só contagens com origem visível.

## Idioma
Interface e templates em inglês (EUA), i18n preparado para es e pt. Código, commits, nomes de recursos em inglês. Specs em português (pt-PT).

## Princípio
Simples primeiro: escolher a solução mais simples que cumpra os requisitos.

## Configuração
Tudo o que o dono do produto precisa de ajustar (preços, quotas, flags, IA, textos legais, retenção, remetente, chaves) vive no **Admin dashboard** (spec S11), nunca em código. Única exceção: o nome de domínio, que é um parâmetro de CDK.
