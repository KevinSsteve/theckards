# Tarefas privadas acedem a ECR/AWS APIs (sec. 5.2).

Status: Accepted (2026-11-10)

## Requisito
VPC 2 AZ, 1 NAT Gateway, endpoint gateway S3. Interface endpoints adiados (custo ~US$ 7/endpoint/AZ); bedrock-runtime endpoint na T9.1.

## Decisão
~US$ 33 (NAT).

## Custo fixo mensal estimado (us-east-1, a validar na fatura)
Tarefas em subnets públicas (pior segurança).

## Alternativa mais simples
NAT numa AZ é ponto único; segunda NAT exige ADR.

## Risco operacional

