# Render deployment runbook

Prepared for one Node web service with a one-GB private disk. This document does not create a Render account, accept terms, enter credentials or deploy. Use the approved sanitized source snapshot. Public deployment and costs need the operator's authorization; any new binding account/service terms need explicit acceptance. Never paste credentials into chat or this document.

## Shape and cost gate

`render.yaml` uses Render's current `0.5c-512mb` web-service plan ID, Singapore, one instance, one-GB disk at `/var/data` and manual deployment. The reviewed hosting budget for this instance is US$10 total; check the final account quote and billed period before creation, do not choose paid extras or exceed that cap. Record the actual recurring price and shutdown plan privately. A deployment template is not a billing limit. Preserve the ledger when suspending/redeploying; disk deletion is a separate destructive action.

Current fields follow [Render's Blueprint reference](https://render.com/docs/blueprint-spec). Node is bounded to `22.x` through [Render's version setting](https://render.com/docs/node-version). Build runs `npm ci --include=dev && npm run build`; `tsx` is now a runtime dependency for `npm start`, while the build needs TypeScript/Vite dev dependencies. Render injects `PORT`; `HOST=0.0.0.0`. The app serves `dist/`, `/api` and both same-origin Agent/Scribe WebSockets from one origin. Keep one instance and no autoscaling: the private budget disk/ledger is not a distributed accounting system.

## Secure environment entry

The blueprint uses `sync: false` prompts for keys and access values. The operator enters them directly into Render settings. Do not create a new provider key or persistent-access grant automatically. A later new secret is added securely to the existing service; `sync: false` prompts are for initial Blueprint creation.

| Setting | Value / requirement |
|---|---|
| `ALLOWED_HOSTS` | Exact final Render hostname, without scheme/path; comma-separated only if specific additional approved hostnames are needed |
| `ALLOWED_ORIGINS` | Exact final `https://` origin(s), without trailing slash/path; no wildcard |
| `DEMO_ACCESS_USER`, `DEMO_ACCESS_PASSWORD` | Operator-created demo access values entered securely; password at least 16 characters; share separately with judges, never URL/source/README |
| Provider keys / agent ID | Existing authorized credentials entered securely; never `VITE_` variables |
| `BUDGET_LEDGER_PATH` | `/var/data/provider-usage-ledger.json` on the attached persistent disk |
| `BUDGET_KILL_SWITCH_PATH` | `/var/data/live.disabled` |
| `PROVIDER_TOTAL_CAP_USD` | Approved total, including preserved historical usage/holds; current authorized total US$10 |
| Request / voice limits | Eight paid operations; 120 seconds/connection; concurrency one; 60 API requests/minute |

Blueprint defaults keep `LIVE_USAGE_APPROVED=false`, `LIVE_USAGE_DISABLED=true` and `BUDGET_INITIALIZE_ALLOWED=false`. They prevent unintended live use. Mock mode remains the app's default even when the operator later enables live.

## First boot and restart-safe ledger

1. Securely log in, review any account/payment/terms flow and stop for user acceptance where required. Select only the approved service/disk. Confirm the actual hostname, quote, origin and demo-access settings before manual deployment.
2. Deploy with live disabled. Verify exact-host HTTPS `/api/health` and native demo authentication. Health probe returns only minimal health; all paid APIs remain protected. Render's health/proxy header behaviour must be verified on the actual service; do not loosen host/origin/HTTPS checks to fix a failure.
3. On first boot only, deliberately set `BUDGET_INITIALIZE_ALLOWED=true` while live remains disabled. Access sanitized `/api/status` through authentication to initialize the new disk with the preserved historical US$1.80 used/held entries. If local testing has added reservations/actuals, securely carry forward the current ledger or use the final reconciled initialization rather than the old seed. Never create a fresh allowance by deploying.
4. Verify the ledger is present on `/var/data` and its committed/remaining amounts include all prior operations. Turn `BUDGET_INITIALIZE_ALLOWED=false` and restart. Check status again: history/request counts must remain. A missing/corrupt expected ledger should block live use, not silently recreate credit.
5. The current published agent is already verified with authentication, V3 Conversational/Expressive mode, an empty first message and a 120-second provider maximum. Recheck metadata if it changes; actual human voice behavior still needs rehearsal. Any further settings/security publication beyond existing authorization requires deliberate approval.
6. After current total/holds and remaining reservations are reconciled, enable `LIVE_USAGE_APPROVED=true`, set `LIVE_USAGE_DISABLED=false` and leave the disk kill-switch absent. Do not reduce conservative reservations just to pass a gate. Unknown bills stay unknown. Reservations are US$1 per voice connection, US$0.25 per vision request and US$0.50 per Map synthesis; one of each needs at least US$1.75 available. These are conservative reservations, not retrieved provider prices.

If the ledger is missing at a later restart, restore/reconcile it. Do not turn initialization on just to bypass the error. Do not move the app to another host without carrying forward cumulative usage and approvals. There must be one authoritative spending ledger: transfer the retained local ledger securely if local human testing spent/reserved anything before deployment, then disable local live use. Do not create independent fresh US$10 allowances on local and hosted servers. Prefer the hosted ledger as authority from the first new metered call.

## Fresh-session hosted verification

Use a fresh browser session and the actual hosted HTTPS URL. Authenticate through the native prompt with the approved demo access. Confirm unauthorized access fails, wrong Origin/Host fails, mock operates and keys are absent from client requests/bundles. Never disable checks or allow every origin after a 403.

With consent and remaining approved budget, share only a fictional app window, inspect preview and run human microphone/question/interrupt/Off-record/reconnect checks. The SDK connects to `wss://<exact-host>/api/session/<ticket>/agent`; Scribe uses the matching `/scribe` path. The provider signed URL/token stay server-only. Both app paths are one-use within 30 seconds; the two connections share a 120-second wall-clock bound from the first socket, and closing one/revoking/killing closes both. Verify authentication in that fresh browser, duration/revoke/kill closure and rejected replay. A local mock or synthetic component pass does not establish hosted human success.

Complete Capture ≥3 useful grounded questions including a guardrail, Map ≥3 new follow-ups and confirmed spoken teach-back, then a blank unseen reporting-officer task. Live confirmation waits for Agent text and a speaking → listening cycle without interruption before the human explicitly confirms; this event gate does not prove audible/understood delivery. Retain actual first/saved drafts and honest human outcome privately. A replay does not constitute another validation run. Record errors and unrun steps distinctly.

## Stop and judge handoff

Off record stops screen/microphone acquisition promptly. For an immediate server paid-call stop, set `LIVE_USAGE_DISABLED=true`, or create the configured disk kill-switch file. Both Agent and Scribe relays check that switch and close revoked/duration-limited transport; provider session material stays server-only. This cannot retract data already transmitted to providers. Revoke active segments and stop browser recording as well.

Give judges the verified URL, privately approved demo-access instructions, a fictional-data warning, exact local/mock/live state and current limits. Do not embed access credentials in submission text or a public link. Keep a mock path for exploration without billable calls. Record actual hosted proof and ledger state privately, then update the public README with tested results only.
