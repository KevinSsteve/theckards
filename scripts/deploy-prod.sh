#!/usr/bin/env bash
# Deploy an already-built image to production, refusing before anything changes if it would fail halfway.
#
#   scripts/deploy-prod.sh <image-tag> [--dry-run] [--allow-red-ci]
#
# Why this exists. On 2026-11-11 a deploy referenced an image tag that had never been built. CloudFormation
# registered task definitions pointing at nothing, ECS could not pull them, and the stack sat in
# UPDATE_IN_PROGRESS until the update was cancelled by hand. Production stayed up only because ECS keeps the
# old tasks serving until new ones are healthy. Every check below runs before the first change.
#
# Order of operations:
#   1. refuse unless the commit is on origin/main, no stack update is running, both images exist with clean
#      scans, and CI passed for that commit;
#   2. run the database migration with the NEW image while the CURRENT release still serves traffic.
#      Migrations are expand-only, so the running code is compatible with them. Migrating after the deploy, as
#      was done before this script, left the new code running against the old schema until the migration
#      finished, which for a release that writes a new column means a few minutes of failed requests;
#   3. deploy the stack;
#   4. confirm both services run the new image, the site answers and an SLO-enabled worker publishes a fresh
#      heartbeat after the service is stable.
#
# --dry-run        run the checks in step 1 and stop.
# --allow-red-ci   continue when CI did not pass. Only for an emergency rollback to an older release.
#
# Requires git, aws, jq, gh, python3 and node (for npx cdk), with credentials for account 116708768297.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
STACK="Theckards-prod"
GITHUB_REPO="${GITHUB_REPO:-KevinSsteve/theckards}"
SITE="https://theckards.linkealls.com"
REPOS=(theckards-web theckards-worker)

TAG=""; DRY_RUN=0; ALLOW_RED_CI=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --allow-red-ci) ALLOW_RED_CI=1 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) TAG="$arg" ;;
  esac
done
[ -n "$TAG" ] || { echo "usage: $0 <image-tag> [--dry-run] [--allow-red-ci]" >&2; exit 2; }

fail() { echo "REFUSED: $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
TEMP_TD=""
cleanup() {
  # The synthesized template contains the operator's mail address, which must not linger on disk.
  rm -rf "$ROOT/infra/cdk.out"
  if [ -n "$TEMP_TD" ]; then aws ecs deregister-task-definition --region "$REGION" --task-definition "$TEMP_TD" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

# ---------- 1. Checks ----------

step "Commit"
FULL="$(git rev-parse --verify --quiet "${TAG}^{commit}")" || fail "$TAG is not a commit in this repository."
git fetch --quiet origin main
git merge-base --is-ancestor "$FULL" origin/main \
  || fail "$TAG is not on origin/main. Production must run what the public repository shows."
echo "ok   $TAG is $FULL, on origin/main"

step "Stack"
STATUS="$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query 'Stacks[0].StackStatus' --output text)"
case "$STATUS" in
  *_IN_PROGRESS) fail "$STACK is $STATUS. Another update is running; see docs/runbooks/deploy-stuck.md." ;;
  *FAILED) fail "$STACK is $STATUS and needs attention first; see docs/runbooks/deploy-stuck.md." ;;
esac
echo "ok   $STACK is $STATUS"

step "Images"
for repo in "${REPOS[@]}"; do
  aws ecr describe-images --region "$REGION" --repository-name "$repo" --image-ids "imageTag=$TAG" >/dev/null 2>&1 \
    || fail "$repo:$TAG does not exist. Build it first (README, Deploy) and wait for the build to succeed."
  SCAN="PENDING"
  for _ in $(seq 1 30); do
    SCAN="$(aws ecr describe-image-scan-findings --region "$REGION" --repository-name "$repo" --image-id "imageTag=$TAG" \
      --query 'imageScanStatus.status' --output text 2>/dev/null || echo PENDING)"
    [ "$SCAN" = "COMPLETE" ] && break
    sleep 10
  done
  [ "$SCAN" = "COMPLETE" ] || fail "the scan of $repo:$TAG did not complete (status $SCAN)."
  SERIOUS="$(aws ecr describe-image-scan-findings --region "$REGION" --repository-name "$repo" --image-id "imageTag=$TAG" \
    --query '[imageScanFindings.findingSeverityCounts.CRITICAL, imageScanFindings.findingSeverityCounts.HIGH]' --output json \
    | jq '[.[] // 0] | add')"
  [ "$SERIOUS" = "0" ] || fail "$repo:$TAG has $SERIOUS critical or high findings."
  echo "ok   $repo:$TAG exists, scan complete, no critical or high findings"
done

step "CI"
CI="$(gh api "repos/$GITHUB_REPO/actions/runs?head_sha=$FULL&per_page=20" \
  --jq '[.workflow_runs[] | select(.name == "CI")][0] | ((.status // "missing") + " " + (.conclusion // "none"))' 2>/dev/null \
  || echo "unavailable")"
if [ "$CI" = "completed success" ]; then
  echo "ok   CI passed for $TAG"
elif [ "$ALLOW_RED_CI" = 1 ]; then
  echo "WARN CI for $TAG is '$CI'. Continuing only because --allow-red-ci was given."
else
  fail "CI for $TAG is '$CI', not 'completed success'. Use --allow-red-ci only for an emergency rollback."
fi

if [ "$DRY_RUN" = 1 ]; then
  step "Dry run: every check passed. Nothing was changed."
  exit 0
fi

# ---------- 2. Migrate with the new image, before anything else changes ----------

step "Migrate with $TAG while the current release keeps serving"
output() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
CLUSTER="$(output ClusterName)"
SUBNETS="$(output PrivateSubnetIds)"
MIGRATION_SG="$(output MigrationSecurityGroupId)"
MIGRATION_TD="$(output MigrationTaskDefinitionArn)"
WORKER_IMAGE="$(aws ecr describe-repositories --region "$REGION" --repository-names theckards-worker \
  --query 'repositories[0].repositoryUri' --output text):$TAG"
# The stack's migration task definition, unchanged except for the image. ECS cannot override an image at run
# time, so a temporary revision is registered and deregistered as soon as the task has stopped.
TD_JSON="$(aws ecs describe-task-definition --region "$REGION" --task-definition "$MIGRATION_TD" --query taskDefinition --output json \
  | jq --arg image "$WORKER_IMAGE" '.containerDefinitions |= map(.image = $image)
      | with_entries(select(.key | IN("family", "taskRoleArn", "executionRoleArn", "networkMode", "containerDefinitions",
          "volumes", "placementConstraints", "requiresCompatibilities", "cpu", "memory", "runtimePlatform", "ephemeralStorage")))')"
TEMP_TD="$(aws ecs register-task-definition --region "$REGION" --cli-input-json "$TD_JSON" \
  --query 'taskDefinition.taskDefinitionArn' --output text)"
TASK="$(aws ecs run-task --region "$REGION" --cluster "$CLUSTER" --task-definition "$TEMP_TD" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$MIGRATION_SG],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)"
aws ecs wait tasks-stopped --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK"
EXIT_CODE="$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK" \
  --query 'tasks[0].containers[0].exitCode' --output text)"
RESULT="$(aws logs get-log-events --region "$REGION" --log-group-name /theckards/prod/migration \
  --log-stream-name "migration/migration/${TASK##*/}" --query 'events[*].message' --output text \
  | tr '\t' '\n' | grep -F 'database migrations complete' || true)"
aws ecs deregister-task-definition --region "$REGION" --task-definition "$TEMP_TD" >/dev/null
TEMP_TD=""
[ "$EXIT_CODE" = "0" ] && [ -n "$RESULT" ] \
  || fail "the migration task exited with '$EXIT_CODE'. Nothing was deployed. See docs/runbooks/migration-failure.md."
echo "ok   $RESULT"

# ---------- 3. Deploy ----------

step "Deploy $STACK at $TAG"
FORWARD_TO="$(aws ssm get-parameter --region "$REGION" --name /theckards/prod/mail-forward-to --query Parameter.Value --output text)"
LOG_DIR="${LOG_DIR:-$ROOT/.kiro/artifacts}"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/deploy-$TAG.log"
# The forwarding address is personal data, and CDK prints it inside a logical ID as well as in full, so both
# forms are removed from the log before it touches the disk.
export REDACT_FULL="$FORWARD_TO"
REDACT_ALNUM="$(printf '%s' "$FORWARD_TO" | tr -cd '[:alnum:]')"
export REDACT_ALNUM
redact() {
  python3 -u -c '
import os, sys
full, alnum = os.environ["REDACT_FULL"], os.environ["REDACT_ALNUM"]
for line in sys.stdin:
    line = line.replace(full, "[redacted]")
    if len(alnum) >= 8:
        line = line.replace(alnum, "redacted")
    sys.stdout.write(line)'
}
( cd infra && THECKARDS_MAIL_FORWARD_TO="$FORWARD_TO" \
    npx cdk deploy "$STACK" -c imageTag="$TAG" -c useAppDbCredentials=true --require-approval never 2>&1 ) \
  | redact > "$LOG" \
  || fail "cdk deploy failed. The migration already ran and is compatible with the current release. Log: $LOG"
grep -E "Deployment time" "$LOG" | sed 's/^/ok   /' || true

# ---------- 4. Verify ----------

step "Verify"
for service in web worker; do
  aws ecs wait services-stable --region "$REGION" --cluster "$CLUSTER" --services "theckards-prod-$service"
  TD="$(aws ecs describe-services --region "$REGION" --cluster "$CLUSTER" --services "theckards-prod-$service" \
    --query 'services[0].taskDefinition' --output text)"
  IMAGE="$(aws ecs describe-task-definition --region "$REGION" --task-definition "$TD" \
    --query 'taskDefinition.containerDefinitions[0].image' --output text)"
  [ "${IMAGE##*:}" = "$TAG" ] || fail "theckards-prod-$service runs ${IMAGE##*/}, not $TAG."
  echo "ok   theckards-prod-$service runs ${IMAGE##*/}"
done
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$SITE/healthz")"
[ "$CODE" = "200" ] || fail "$SITE/healthz returned $CODE."
READY="$(curl -s "$SITE/readyz")"
printf '%s' "$READY" | grep -q '"db":"ok"' || fail "$SITE/readyz returned $READY."
echo "ok   healthz $CODE, readyz $READY"

# SLO-enabled workers must prove that the newly stable revision can read its durable source and call PutMetricData.
# The metric timestamp is the UTC minute boundary, so only a datapoint newer than this verification phase counts.
if git show "$FULL:apps/worker/src/index.ts" 2>/dev/null | grep -q 'publishSloMetrics'; then
  HEARTBEAT_AFTER="$(date -u +%FT%TZ)"
  HEARTBEAT=""
  for _ in $(seq 1 18); do
    HEARTBEAT="$(aws cloudwatch get-metric-statistics --region "$REGION" \
      --namespace Theckards/SLO --metric-name PublisherHeartbeat \
      --start-time "$HEARTBEAT_AFTER" --end-time "$(date -u +%FT%TZ)" --period 60 --statistics Maximum \
      --query 'sort_by(Datapoints,&Timestamp)[-1].Timestamp' --output text 2>/dev/null || true)"
    [ -n "$HEARTBEAT" ] && [ "$HEARTBEAT" != "None" ] && break
    sleep 10
  done
  [ -n "$HEARTBEAT" ] && [ "$HEARTBEAT" != "None" ] \
    || fail "the new worker published no SLO heartbeat after $HEARTBEAT_AFTER. See docs/runbooks/slo-metrics-publisher.md."
  echo "ok   SLO publisher heartbeat $HEARTBEAT"
fi

echo
echo "Deployed $TAG. Log: $LOG"
