# Dois ambientes isolados (staging/prod) em contas separadas (guião sec. 5.1).

Status: Accepted (2026-11-10)

## Requisito
Produção na conta de gestão 116708768297 (decisão explícita do dono do produto), região us-east-1. Staging NÃO está implantado; a stack aceita `-c envName=staging` mas partilharia a mesma conta (isolamento só por prefixo). Desvio do guião aceite.

## Decisão
Sem custo adicional de contas.

## Custo fixo mensal estimado (us-east-1, a validar na fatura)
Contas membro separadas via Organizations (recomendado quando houver tráfego real).

## Alternativa mais simples
Conta de gestão tem raio de explosão máximo e não pode aplicar SCPs a si própria. Mitigação: roles com prefixo theckards-, bootstrap CDK dedicado (qualifier theckards), deletion protection e RETAIN. Migrar para conta membro é uma tarefa futura (export/import de dados).

## Risco operacional

