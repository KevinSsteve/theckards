# PDF, selos, emails e webhooks não podem bloquear a UI (sec. 5.1).

Status: Accepted (2026-11-10)

## Requisito
Serviço Fargate `worker` 0,5 vCPU/1 GB, 1–3 tarefas, scaling por mensagens visíveis na fila.

## Decisão
~US$ 18.

## Custo fixo mensal estimado (us-east-1, a validar na fatura)
Correr no web até haver carga.

## Alternativa mais simples
Mais uma peça a operar; DLQ e alarme de idade da fila mitigam.

## Risco operacional

