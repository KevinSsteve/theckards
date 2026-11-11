# Runbook: a deploy is stuck or half-done

**Symptom.** `cdk deploy` has been running for a long time, or was interrupted, and
`aws cloudformation describe-stacks --stack-name Theckards-prod` reports `UPDATE_IN_PROGRESS`.

**First, is production up?** Almost certainly. Both services deploy with `minimumHealthyPercent: 100`, so ECS
keeps the current tasks serving until the new ones are healthy. Check before anything else:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://theckards.linkealls.com/healthz
curl -s https://theckards.linkealls.com/readyz
```

## What happened on 2026-11-11

A deploy passed `-c imageTag=4ecb519`, a commit whose image had never been built. CloudFormation registered new
task definitions pointing at `theckards-web:4ecb519`, ECS could not pull it, and the services waited with one
failed task each:

```
(service theckards-prod-web) was unable to place a task.
Reason: CannotPullContainerError: pull image manifest has been retried 7 time(s): failed to resolve ref ...
```

The circuit breaker needs several failed tasks before it gives up, and ECS backs off between attempts, so the
stack would have stayed in progress for a long time. The update was cancelled, CloudFormation rolled back cleanly
in eight minutes, and production never stopped answering. `scripts/deploy-prod.sh` now refuses to deploy a tag
that does not exist.

## 1. Find out what it is waiting for

```sh
# The newest events, most of which will be UPDATE_COMPLETE; look for the one still in progress.
aws cloudformation describe-stack-events --stack-name Theckards-prod --max-items 15 \
  --query 'StackEvents[*].[Timestamp,LogicalResourceId,ResourceStatus,ResourceStatusReason]' --output text

# If it is an ECS service, the service events say why.
aws ecs describe-services --cluster theckards-prod-cluster --services theckards-prod-web theckards-prod-worker \
  --query 'services[*].events[0:5].message' --output text
```

| ECS says | Cause | Action |
| --- | --- | --- |
| `CannotPullContainerError` | The image tag does not exist in ECR | Cancel the update (step 2), then build the image and deploy again |
| `ResourceInitializationError` mentioning secrets | The task cannot read a secret | Check the task execution role and the secret; cancel |
| Tasks start, then fail health checks | The new release does not start | Read `/theckards/prod/web`; cancel, fix forward |

## 2. Cancel and let it roll back

```sh
aws cloudformation cancel-update-stack --stack-name Theckards-prod
aws cloudformation wait stack-rollback-complete --stack-name Theckards-prod
```

`wait stack-rollback-complete` returns when the stack reaches `UPDATE_ROLLBACK_COMPLETE`. Then confirm the
services are back on the previous release and nothing new was left behind:

```sh
for s in web worker; do
  TD=$(aws ecs describe-services --cluster theckards-prod-cluster --services theckards-prod-$s --query 'services[0].taskDefinition' --output text)
  aws ecs describe-task-definition --task-definition "$TD" --query 'taskDefinition.containerDefinitions[0].image' --output text
done
```

## 3. If the rollback itself fails

The stack goes to `UPDATE_ROLLBACK_FAILED`. Read the failed event, fix what it names, then:

```sh
aws cloudformation continue-update-rollback --stack-name Theckards-prod
```

Only if a resource genuinely cannot be restored, skip it with `--resources-to-skip <LogicalId>`, and write down
what was skipped, because the stack no longer matches reality for that resource.

## 4. Redeploy

```sh
scripts/deploy-prod.sh <tag> --dry-run   # every check, no changes
scripts/deploy-prod.sh <tag>
```

## Do not

- Do not delete the stack. Termination protection is on for a reason; stateful resources are retained, but the
  service would be down until a new stack is built.
- Do not push an image under an existing tag to unstick it. The repositories are `IMMUTABLE`, so it fails, and
  the deploy should name what was built rather than be made to fit.
