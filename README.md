# Theckards

A trust layer for agreements between people who have already decided to deal with each other. Two parties create an agreement from a guided template in under 30 seconds. They sign it in person with a single-use QR code, keep a record of confirmations, messages, evidence and notes, and get a sealed PDF with a verifiable integrity receipt. Either party can export the whole record as a **dossier**: one archive that lists every file with its SHA-256, is sealed like any other document, and can be checked years later with `sha256sum` and `openssl` alone.

Production: https://theckards.linkealls.com (AWS, us-east-1).

## Resurrection: the wax seal and the signet ring

Submitted to **Kiroween 2026** in the *Resurrection* category. For centuries a wax seal and a signet ring were how
people closed an agreement in person, and they worked for three reasons: breaking the wax showed tampering, only
the holder of the signet could press the mark, and anyone could recognise it. Then the practice died, and what
replaced it asks two people standing next to each other to trust an emailed link.

Theckards brings the ceremony back and keeps all three properties, with modern cryptography doing the work the wax
used to do:

| Wax seal and signet | Theckards |
| --- | --- |
| Breaking the wax reveals tampering | Changing a single byte makes verification fail (SHA-256) |
| Only the signet holder can press the mark | A private key that never leaves AWS KMS (ECDSA P-256) |
| Anyone could recognise the mark | A published public key and a seal impression printed on the document |
| Sealed in person, in front of witnesses | In-person signing: a single-use QR code and a code exchanged between the two devices |

Every sealed document carries a **seal impression** pressed from its own identifier, so each document has a
distinct mark instead of one signet for one person. The same impression is shown on `/verify`, for a reader to
compare against the printed one. The geometry is a pure function:
[`packages/domain/src/seal-mark.ts`](packages/domain/src/seal-mark.ts).

**Built with [Kiro](https://kiro.dev).** How the specs and steering documents in [`/.kiro`](.kiro) shaped this
project, and where they changed the result, is written up in [`docs/kiro-usage.md`](docs/kiro-usage.md). That page
also explains how to test the app, including public verification with no account.

Theckards **never** handles money between the parties, gives legal advice, decides disputes or rates people. The full guardrail list (G1–G11) is in [`.kiro/steering/product.md`](.kiro/steering/product.md).

## Repository layout

| Path | Contents |
| --- | --- |
| `.kiro/specs/` | Feature specs S1–S11 (requirements, design, tasks) written with Kiro |
| `docs/kiro-usage.md` | How Kiro was used, and how to test the app |
| `docs/kiroween-*.md` | Kiroween submission copy and the demo video shot list |
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

Two steps, always in this order: build the image for a pushed commit, then deploy that tag.

```sh
# 1. Build. CodeBuild (buildspec.yml) builds both images; Dockerfile.web runs lint, typecheck and tests first.
TAG=$(git rev-parse --short HEAD)
git archive --format=zip --output=/tmp/source.zip HEAD
aws s3 cp /tmp/source.zip s3://theckards-build-src-116708768297-us-east-1/source.zip
aws codebuild start-build --project-name theckards-image-build \
  --environment-variables-override name=IMAGE_TAG,value=$TAG,type=PLAINTEXT

# 2. Deploy, once the build has succeeded.
scripts/deploy-prod.sh $TAG --dry-run   # every check, no changes
scripts/deploy-prod.sh $TAG
```

[`scripts/deploy-prod.sh`](scripts/deploy-prod.sh) refuses before changing anything unless the commit is on
`origin/main`, no stack update is running, both images exist with clean scans, and CI passed. It then runs the
database migration with the new image while the current release still serves traffic, deploys the stack, and
confirms both services run the new image. The mail-forwarding target is personal data: the script reads it from
SSM and removes it from the deploy log. If a deploy hangs, see
[`docs/runbooks/deploy-stuck.md`](docs/runbooks/deploy-stuck.md).

## Verify a record

Anyone can check a sealed PDF at https://theckards.linkealls.com/verify. The file is hashed locally in the browser and never uploaded. The offline method is described at `/verify/how`.

A dossier verifies itself. [`scripts/verify-dossier.mjs`](scripts/verify-dossier.mjs) imports nothing from this
repository and checks the archive the way an outside auditor would:

```sh
node scripts/verify-dossier.mjs dossier.zip dossier.receipt.json keys.json
```

It confirms that every file matches the hash the manifest claims, that `manifest.json` matches the receipt's
`content_sha256`, that the archive matches the receipt's `sha256`, and that the signature verifies against the key
published at `/.well-known/theckards-keys.json`. `README.txt` inside the archive explains how to do the same by
hand.

## License

[Apache License 2.0](LICENSE). The legal texts under `packages/database/src/legal-*.ts` are product copy for the
hosted service, not legal advice; review them with a qualified attorney before reusing them.
