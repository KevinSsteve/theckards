# S11 — Design

## Onde vive
Rota `/admin` no mesmo Next.js (`apps/web/src/app/admin`), route handlers `/api/admin/*` com `withRoute({auth:'admin', role})`. Sem novo serviço (simples). CloudFront/WAF: regra rate-limit específica e opcional allow-list de IP configurável (CDK context) como defesa extra.

## Armazenamento de config
| Tipo | Armazém | Notas |
|---|---|---|
| Valores de negócio (planos, limites, retention, email templates, fraud, ai) | `app_settings(key, value jsonb, version, updated_by, updated_at)` + `app_settings_history` | cache em memória 30 s + invalidação por versão |
| Feature flags | AWS AppConfig (Hosted configuration, profile `feature-flags`) | Admin cria `HostedConfigurationVersion` + `StartDeployment` (strategy `AllAtOnce` staging, `Linear` prod); app lê via AppConfig Agent/Data API com cache |
| Segredos | Secrets Manager `theckards/{env}/admin/*` | role do admin handler com `PutSecretValue`/`CreateSecret` só nesse prefixo; sem `GetSecretValue` na rota admin; consumidores (web/worker) leem |
| Textos legais | `legal_documents` | DRAFT→APPROVED; imutável após aprovação |
| Email templates | `email_templates(key, locale, subject, body_mjml, version, status)` | variáveis validadas; sem HTML arbitrário em campos de utilizador |

Parâmetros que **não** são dinâmicos (domínio, contas, tamanho de RDS) permanecem em CDK; o Admin mostra o seu estado em leitura.

## Controlo de acesso
Cognito grupo `admins` (owner) e `support`; claim `cognito:groups` verificado no servidor a cada pedido contra `admin_users` (allow-list em BD, `status`). Step-up auth: `recent_auth_at` na sessão; ações sensíveis exigem ≤5 min, senão redireciona a re-login com MFA.

## Auditoria
`audit_logs` (actor_type=ADMIN) com diff redigido; hash encadeado (S4). Exportável. Alarme em ações sensíveis (SNS → email do owner).

## Ecrãs (sidebar)
Overview · Users · Abuse · Plans & Limits · Flags · AI · Legal · Retention · Email · Integrations · Jobs · Launch readiness · Audit log. Componentes de formulário genéricos gerados de schemas zod (`settingsRegistry`: key → schema, label, secção, `sensitive`, `requiresReauth`), evitando UI ad hoc por setting.

## Métricas
Overview lê agregados SQL (read-only, sem PII) + CloudWatch `GetMetricData` (filas, 5xx, IA, SES, custo). Custo: Cost Explorer API (opcional, custa por pedido; cache 6 h).

## Launch readiness (checks automáticos)
SES `GetAccount` (ProductionAccessEnabled), identidade/DKIM verificados; `legal_documents` todos APPROVED; último restore test registado (`ops_events`); alarmes em OK/INSUFFICIENT; AppConfig deployment ativo; Stripe webhook recebeu evento de teste; Bedrock model ping OK; backups ativos.

## Bootstrap
Seed CDK cria o 1.º `owner` (email passado em context `ownerEmail`); utilizador Cognito criado com convite por email e MFA obrigatório no 1.º login.
