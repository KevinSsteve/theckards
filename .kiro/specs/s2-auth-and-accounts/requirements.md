# S2 — auth-and-accounts: Requisitos (sec. 3.1, 3.6 R-LEG, 7, 9)

- R-AUTH-1 WHEN um visitante entra com email ou Google THEN o sistema SHALL autenticar via Cognito e criar a conta no primeiro login.
- R-AUTH-2 WHEN a contraparte abre o link do convite THEN o sistema SHALL permitir rever e assinar com verificação por código de email, sem criar conta.
- R-AUTH-3 A sessão SHALL ser BFF: cookie `__Host-` HttpOnly, Secure, SameSite=Lax, CSRF; nenhum token acessível a JS; expiração absoluta 12 h e inatividade 30 min.
- R-AUTH-4 Token de convidado: uso único guardado como hash, validade 7 dias; após o código, sessão curta de 2 h limitada ao seu acordo e papel.
- R-AUTH-5 Código de email: 6 dígitos, 10 min, 5 tentativas, guardado como hash; limites 5/h por email e 10/h por IP.
- R-AUTH-6 Utilizadores do grupo Cognito `admins` SHALL exigir MFA (TOTP) e ter sessão própria mais curta (4 h / 15 min inatividade).
- R-AUTH-7 Contas suspensas SHALL ser impedidas de criar sessão e novos acordos.
- R-LEG-1 WHEN o utilizador cria conta ou assina THEN o sistema SHALL registar a versão aceite de Termos, Privacidade e ESIGN (`user_consents`).
- R-LEG-2 WHEN o utilizador pede eliminação THEN o sistema SHALL eliminar/anonimizar conforme a tabela de retenção (sec. 9.1) e informar o que fica e porquê. `GET /api/me/export` SHALL exportar os dados.
- R-LEG-3 Antes de assinar, SHALL mostrar a política de retenção e eliminação.
- R-LEG-4 IP e user agent SHALL ser tratados como dados pessoais: mínimo, acesso restrito, retenção definida (configurável no Admin).
- R-LEG-5 As versões dos textos legais SHALL vir da BD (Admin → Legal); sem versão APROVADA, o registo/assinatura em produção SHALL ser bloqueado.
- R-SEC-1 Todas as rotas SHALL ter autenticação (ou guest token), autorização por recurso, validação zod, rate limit, `Idempotency-Key` nas escritas, erros `application/problem+json`, `X-Request-Id`.
- R-SEC-2 Testes automáticos de IDOR em todas as rotas (inclui guest e admin).

## Aceitação
Um utilizador entra, aceita os termos; um convidado abre o link e verifica o email sem criar conta.
