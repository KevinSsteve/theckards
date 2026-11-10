# S11 — admin-dashboard: Requisitos

Objetivo: o dono do produto configura e opera tudo num único dashboard, sem tocar em código nem consola AWS (exceto os passos humanos listados no README das specs).

## Acesso e segurança
- R-ADM-1 `/admin` e `/api/admin/*` SHALL ser acessíveis só a utilizadores do grupo Cognito `admins` com MFA; sessão ADMIN separada (4 h / 15 min inatividade); nunca acessível por guest.
- R-ADM-2 Toda a alteração SHALL ser registada em `audit_logs` (quem, o quê, antes/depois com segredos redigidos) e exigir confirmação; alterações sensíveis (preços, flags de produção, chaves, aprovação legal) SHALL exigir re-autenticação recente (≤5 min).
- R-ADM-3 Segredos (Stripe, Google OAuth, RPC Base) SHALL ser write-only: gravados no Secrets Manager, nunca devolvidos nem logados; o UI mostra só "configured / last rotated".
- R-ADM-4 Papéis: `owner` (tudo) e `support` (só leitura + suspender/denúncias). Primeiro `owner` criado por CDK/seed com email fornecido no deploy.
- R-ADM-5 Config SHALL ser validada (zod), versionada (`app_settings_history`) e reversível (rollback para versão anterior).

## Configuração (secções)
- R-ADM-10 **Plans & Limits**: planos, preços (Stripe Price ids), quotas mensais, limites de convites, OTP, tamanho de upload, retenção de convite/expiração.
- R-ADM-11 **Feature flags** (AppConfig): `AI_ENABLED`, `ANCHOR_ENABLED`, `PUBLIC_PROFILE_ENABLED`, `CUSTOM_TEMPLATES_ENABLED`, `RESEAL_AFTER_PURCHASE`, `SIGNUPS_ENABLED`, `MAINTENANCE_MODE`, locales ativos. Rollout com deployment strategy de AppConfig.
- R-ADM-12 **AI**: modelo, fallback, timeout, max tokens, limites diários, preços para estimativa; botão "Test model" que valida o ID/região (S9).
- R-ADM-13 **Legal**: editar rascunhos (Markdown) de Termos, Privacy, ESIGN e Aviso, versionar, pré-visualizar e **Approve** (regista aprovador/hora); só versões APROVADAS ficam ativas (gate R-LEG-5/6).
- R-ADM-14 **Retention**: prazos por categoria da sec. 9.1 (os "a definir" começam vazios = sem apagar automaticamente; planos nunca prometem prazos).
- R-ADM-15 **Email**: remetente/Reply-To (dentro do domínio verificado), estado DKIM/SPF/DMARC/sandbox (leitura via SES), templates de email (EN) editáveis com variáveis permitidas, lista de supressão.
- R-ADM-16 **Integrations**: Stripe (keys, webhook secret, modo), Google OAuth, RPC da Base (para âncora), destinos de alerta (email/SMS/webhook).
- R-ADM-17 **Anti-fraude** (M5): limiares F2/F3/F5.

## Operação
- R-ADM-20 **Overview**: métricas de negócio (acordos criados, % assinados por ambos, conversão Free→pago, receita por acordo, custo por acordo), SLOs, estado de filas/DLQ, falhas de webhook, entrega de email, custos de IA.
- R-ADM-21 **Users**: pesquisa (email hash/id), ver plano/estado, suspender/reativar, motivo registado; **sem** ver conteúdo de acordos/provas (privacidade) salvo acesso de suporte explícito com consentimento do utilizador (fora do v1).
- R-ADM-22 **Abuse reports**: fila de denúncias, ação e nota.
- R-ADM-23 **Jobs**: reprocessar DLQ/webhooks Stripe, re-enviar emails, reconciliar schedules (ações idempotentes e auditadas).
- R-ADM-24 **Launch checklist**: página que mostra o estado automático dos itens da sec. 13 (SES fora do sandbox, textos aprovados, backup restore testado, alarmes ativos, flags) como painel de prontidão.
- R-ADM-25 O Admin SHALL NOT permitir: mover fundos, alterar acordos assinados, editar confirmações/mensagens/provas, ou atribuir pontuações/rótulos a pessoas (G1, G2, G11).
- R-ADM-30 UI em inglês, WCAG 2.2 AA, 4 estados por ecrã, protegida por WAF (rate limit) e `X-Robots-Tag: noindex`.

## Aceitação
Um owner novo, com MFA, configura planos, flags, IA, textos legais (aprova), email e Stripe só pelo dashboard; cada mudança aparece no audit log; segredos não são legíveis; um IDOR/privilege-test prova que utilizadores normais e guests recebem 403/404 em todas as rotas admin.
