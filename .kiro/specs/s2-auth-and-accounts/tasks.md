# S2 — Tarefas

- [ ] T2.1 Cognito (CDK) + callback BFF, sessões, CSRF, tabela `users`, `sessions`; grupo `admins` com MFA.
- [ ] T2.2 `withRoute` wrapper, erros problem+json, idempotency keys, rate limit em BD, X-Request-Id, regra de lint.
- [ ] T2.3 `legal_documents` + aceites (R-LEG-1) + gate de bloqueio sem versão APROVADA (R-LEG-5) + UI de consentimento.
- [ ] T2.4 Link de convidado, OTP por SES, sessão GUEST 2 h (R-AUTH-2/4/5).
- [ ] T2.5 Export e eliminação de conta (R-LEG-2) com resumo "o que fica e porquê"; limpeza de emails de convite.
- [ ] T2.6 Gerador de testes de IDOR a partir do OpenAPI; falha de build sem cobertura.
- [ ] T2.7 Ecrãs: Sign in, Settings (conta, export, delete), aceite de termos; 4 estados + a11y.

**Aceitação:** utilizador entra e aceita termos; convidado verifica email e fica limitado ao seu acordo/papel.
