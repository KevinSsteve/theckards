# A conta tem um bootstrap CDK de outro projeto com política de execução restrita.

Status: Accepted (2026-11-10)

## Requisito
Novo bootstrap com qualifier `theckards` (stack CDKToolkit-theckards), execução com PowerUserAccess + IAMFullAccess. O bootstrap existente não foi alterado.

## Decisão
~US$ 1.

## Custo fixo mensal estimado (us-east-1, a validar na fatura)
Alargar a política do projeto existente (rejeitado: afetaria outro projeto).

## Alternativa mais simples
Política de execução ampla; restringir quando a infra estabilizar.

## Risco operacional

