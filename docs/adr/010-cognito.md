# Login email/Google e grupo admins com MFA (sec. 3.1).

Status: Accepted (2026-11-10)

## Requisito
User pool Essentials, client confidencial, code flow no BFF, grupos admins/support. Rotação de segredo da BD adiada (a app lê no arranque).

## Decisão
~US$ 0 até 10k MAU.

## Custo fixo mensal estimado (us-east-1, a validar na fatura)
Auth própria (não recomendado).

## Alternativa mais simples
MFA para admins é imposto pelo BFF; rotação de credenciais pendente (S8).

## Risco operacional

