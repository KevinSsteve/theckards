# Theckards v1 — Índice de specs

Fonte: guião "Theckards v1 — Sem fundos" v1.2. Em caso de conflito, o guião manda; esta árvore acrescenta decisões de produção e o Admin dashboard (S11).

| Spec | Pasta | Marco | Depende de |
|---|---|---|---|
| S1 | s1-foundation-infra | M1 | — |
| S2 | s2-auth-and-accounts | M1 | S1 |
| S3 | s3-agreement-engine | M1 | S1, S2 |
| S4 | s4-signing-and-sealing | M1/M2 | S2, S3 |
| S9 | s9-ai-contract-assistant | M1/M2 | S3, S11 |
| S11 | s11-admin-dashboard | M1→M3 | S1, S2 (cresce com cada spec) |
| S5 | s5-evidence-messages-cases | M2 | S4 |
| S6 | s6-verify-and-dossier | M2 | S4, S5 |
| S7 | s7-billing | M3 | S2, S11 |
| S8 | s8-launch-hardening | M3/M4 | todas |
| S10 | s10-trust-profile | M5 (pós go-live) | S5, S11 |

## Decisões tomadas (em vez de perguntar)
O guião pede para perguntar os itens em aberto. Por instrução do dono do produto, avançou-se com defaults e **tudo o que é ajustável fica no Admin dashboard (S11)**.

| Item (sec. 14) | Decisão | Onde se altera |
|---|---|---|
| Domínio | Parâmetro CDK `domainName` (único input de deploy) | `cdk.json` context |
| Remetente de email | Admin; SES identity criada por CDK para o domínio | Admin → Email |
| Preços e quotas | Sec. 2 como seed (Free 2/mês; US$4,99/acordo; Pro US$19, 30/mês) | Admin → Plans |
| Textos legais | Versionados na BD, estado RASCUNHO→APROVADO; gate de build/runtime | Admin → Legal |
| Biblioteca de PDF | `pdf-lib` (determinístico, fontes embutidas) — ADR-005; confirmar na doc | código |
| Âncora Base | Desligada (`ANCHOR_ENABLED=false`) | Admin → Flags |
| Cognito | Essentials | CDK |
| Idioma | EN; es/pt depois | Admin → Flags (locales) |
| Base de dados | RDS PostgreSQL single-AZ, PITR, backups 14 d (ADR-002) | CDK/ADR |
| RTO/RPO | RTO 4 h, RPO 5 min (PITR) como meta inicial (ADR-009) | ADR |
| Worker | Tarefa Fargate própria, 1–3, escala por profundidade da fila (ADR-004) | CDK |
| Modelos de IA | Defaults do guião; IDs/região por VERIFICAR no deploy | Admin → AI |

## Itens que exigem ação humana (não automatizáveis)
1. Conta AWS (staging/prod) e AWS Organizations; pedido de saída do SES sandbox; acesso a modelos Bedrock.
2. Conta Stripe e chaves (introduzidas no Admin, gravadas no Secrets Manager).
3. Domínio registado (delegação NS para Route 53).
4. Aprovação dos textos legais (botão no Admin → Legal).
