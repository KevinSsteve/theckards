# Regras de produção
- Nenhum endpoint sem autenticação (ou token de convidado), autorização por recurso, validação e rate limit.
- Cada serviço tem liveness, readiness, graceful shutdown, timeouts e retries com backoff.
- Infraestrutura toda em CDK, recursos com estado em RETAIN, sem passos manuais.
- Cada falha previsível tem alarme e runbook (`docs/runbooks/`).
- Build de produção falha com textos legais em RASCUNHO ou sem testes de IDOR.
- Rotas `/admin` e `/api/admin/*`: só grupo Cognito `admins` com MFA, auditadas em `audit_logs`, nunca expostas a guests.
- Definição de Pronto: cumpre requisitos e guardrails; testes unitários e de integração; lint, typecheck, cdk-nag, Trivy, gitleaks; infra via CDK; teste de IDOR por rota nova; alarme + runbook por falha previsível; sem PII em logs; corre em staging.
