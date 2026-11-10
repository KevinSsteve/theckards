# Theckards

A trust layer for agreements between people who have already decided to deal with each other. Two parties create an agreement from a guided template in under 30 seconds. They sign it in person with a single-use QR code, keep a record of confirmations, messages and notes, and get a sealed PDF with a verifiable integrity receipt.

Production: https://theckards.linkealls.com (AWS, us-east-1).

Theckards **never** handles money between the parties, gives legal advice, decides disputes or rates people. The full guardrail list (G1–G11) is in [`.kiro/steering/product.md`](.kiro/steering/product.md).

## Repository layout

| Path | Contents |
| --- | --- |
| `.kiro/specs/` | Feature specs S1–S11 (requirements, design, tasks) written with Kiro |
| `.kiro/steering/` | Product guardrails, tech stack and production rules applied to all work |
| `apps/web` | Next.js app (UI and BFF API), Cognito sessions, signing, record, cases |
| `apps/worker` | Queue worker: deterministic PDFs, KMS-signed seals, addenda, migrations |
| `packages/domain` | Pure domain logic: state machine, templates, confirmations, receipts |
| `packages/database` | Expand-only SQL migrations and legal document drafts |
| `infra` | AWS CDK (TypeScript) with cdk-nag |
| `api/openapi.yaml` | HTTP API contract |
| `docs/adr`, `docs/runbooks` | Architecture decisions and operational runbooks |

## Develop

```sh
pnpm install
pnpm lint && pnpm -r typecheck && pnpm test
```

## Deploy

Images are built by CodeBuild (`buildspec.yml`) and deployed with CDK by image tag. The mail-forwarding target is personal data and is not stored in git. Each deploy reads it from SSM:

```sh
export THECKARDS_MAIL_FORWARD_TO=$(aws ssm get-parameter --name /theckards/prod/mail-forward-to --query Parameter.Value --output text)
cd infra && npx cdk deploy Theckards-prod -c imageTag=<tag> -c useAppDbCredentials=true
```

Migrations run as a one-off ECS task. See [`docs/runbooks/migration-failure.md`](docs/runbooks/migration-failure.md).

## Verify a record

Anyone can check a sealed PDF at https://theckards.linkealls.com/verify. The file is hashed locally in the browser and never uploaded. The offline method is described at `/verify/how`.

## License

[Apache License 2.0](LICENSE). The legal texts under `packages/database/src/legal-*.ts` are product copy for the
hosted service, not legal advice; review them with a qualified attorney before reusing them.
