# Migrações expand/contract (sec. 6).

Status: Accepted (2026-11-10)

## Requisito
SQL puro versionado + runner simples (node-pg-migrate) executado como tarefa one-off pelo pipeline. Enums como text + CHECK gerado a partir de `packages/domain`.

## Decisão
0.

## Custo fixo mensal estimado (us-east-1, a validar na fatura)
Drizzle/Prisma migrate.

## Alternativa mais simples
Runner próprio exige disciplina; mitigado por CI.

## Risco operacional

