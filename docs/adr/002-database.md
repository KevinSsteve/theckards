# Modelo relacional, PITR, backups cifrados (sec. 5, 6).

Status: Accepted (2026-11-10)

## Requisito
RDS PostgreSQL 16, db.t4g.small, gp3 20 GB, single-AZ, backup 14 dias, PITR, deletion protection, KMS, IAM auth ativa.

## Decisão
~US$ 28 (instância ~25 + storage ~3).

## Custo fixo mensal estimado (us-east-1, a validar na fatura)
db.t4g.micro; ou Aurora Serverless v2 (mínimo ~US$ 45/mês).

## Alternativa mais simples
Single-AZ: queda de AZ = indisponibilidade até restauro (RTO 4 h). Multi-AZ exige novo ADR.

## Risco operacional

