# Estáticos via S3 OAC e deploy sem Docker local (sec. 5).

Status: Accepted (2026-11-10)

## Requisito
/_next/static servido pelo ALB com cache do CloudFront (CACHING_OPTIMIZED), sem bucket de estáticos. Imagens construídas por CodeBuild (sandbox sem Docker).

## Decisão
~US$ 1.

## Custo fixo mensal estimado (us-east-1, a validar na fatura)
Bucket S3 de estáticos + upload no pipeline.

## Alternativa mais simples
Estáticos passam pelo ALB em cache-miss; revisitar com carga (T8.3).

## Risco operacional

