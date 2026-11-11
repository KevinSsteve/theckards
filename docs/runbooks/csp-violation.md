# Runbook: a page stops working under the Content-Security-Policy

**Symptom.** A button does nothing, a page stays unstyled in places, an upload or the `/verify` hash never
starts, or a page loads but nothing on it responds. The browser console shows a line starting with
`Refused to execute`, `Refused to apply inline style`, `Refused to connect` or `Refused to evaluate`.

**Why there is no alarm.** Browsers report a violation only by posting it, without credentials, to an endpoint
the policy names. Such an endpoint would accept unauthenticated writes from anyone, which the
[production rules](../../.kiro/steering/production.md) do not allow. So the known causes are stopped before
release instead: tests fail the build on a style attribute, on zod in code the browser runs, on a prerendered page
and on a second, static policy (`apps/web/src/middleware.test.ts`). The browser check after a release is manual for
now ([security-scan](../security-scan.md)).

## 1. Read the refusal

Open the page with the developer tools console open. Each refusal names the directive and the thing refused.

| Console says | Cause | Fix |
| --- | --- | --- |
| `Refused to execute inline script` or `script` from `/_next/static/...` refused, on every script | The page was served without a nonce: it was prerendered at build time, or the middleware did not run on it. | Check `await connection()` is still in `app/layout.tsx` and that the path is not excluded by the `matcher` in `src/middleware.ts`. `next build` must list every page as `ƒ`. |
| `Refused to apply inline style` | A `style={{...}}` prop, or HTML inserted with a `style` attribute. | Move it to a class in `globals.css`. Never add `'unsafe-inline'`. |
| `Refused to connect to https://...` | The page calls an origin that is not in `connect-src`. | If the call is intended, add the origin in `src/middleware.ts` from configuration, with a test in `server/http/csp.test.ts`. If not, find out why the page is calling it. |
| `Refused to evaluate a string as JavaScript` | Code that uses `eval` or `new Function`, often a library probing for it (zod does). | Keep the library out of the browser bundle, or use one that does not evaluate strings. Never add `'unsafe-eval'`. |
| `Refused to compile or instantiate WebAssembly` | `'wasm-unsafe-eval'` was removed from `script-src`. | Restore it; `/verify` hashes files with WebAssembly. |

The current policy is in the response headers of any page:

```sh
curl -sSI -A 'Mozilla/5.0 runbook' https://theckards.linkealls.com/verify | grep -i '^content-security-policy'
```

## 2. If production is broken now

Roll back to the previous release rather than loosening the policy under pressure:

```sh
scripts/deploy-prod.sh <previous-tag>
```

Image tags are commits. The first command prints the release now running; the second, the one on the revision
before it. A revision can also change with configuration alone, so if both show the same tag, step the number down
until it differs.

```sh
TD=$(aws ecs describe-services --cluster theckards-prod-cluster --services theckards-prod-web --query 'services[0].taskDefinition' --output text)
aws ecs describe-task-definition --task-definition "$TD" --query 'taskDefinition.containerDefinitions[0].image' --output text
aws ecs describe-task-definition --task-definition "${TD%:*}:$(( ${TD##*:} - 1 ))" --query 'taskDefinition.containerDefinitions[0].image' --output text
```

Then fix forward with a test that reproduces the refusal.

## What not to do

Do not add `'unsafe-inline'`, `'unsafe-eval'`, `*` or a bare scheme such as `https:` to make a refusal go away.
Each of them turns off the protection for every page, and the passive ZAP scan rates each one Medium.
