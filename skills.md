# IntentLock Coding-Agent Handoff

This file is the project-specific working guide for any AI coding agent continuing IntentLock. Read it together with `README.md` before making changes. Preserve the user’s goal: a polished, fully usable local product/simulator, not a throwaway demo. The user prefers fast progress and expects the agent to continue through phases without asking for a new prompt after every phase.

## First actions on a continuation

1. Read `README.md`, this file, and `AGENTS.md`. The Next.js-managed block in `AGENTS.md` is required; do not remove or replace it.
2. Inspect `git status --short` before edits. Keep the current checkout and `.intentlock/store.json` data. Do not reset, delete, or overwrite user data to get clean demo states.
3. Inspect current source rather than assuming that the descriptions below remain current. In particular read `src/lib/domain.ts`, `src/lib/store.ts`, API routes, and the relevant part of `src/app/page.tsx` for the task.
4. If editing Next.js code, follow `AGENTS.md`: read the relevant installed Next.js guide under `node_modules/next/dist/docs/` first because this project uses Next.js 16 and APIs may differ from older examples.
5. Make the smallest coherent changes that advance the active phase. Continue independent work without pausing for routine preferences. Ask only if a missing business or safety decision cannot be inferred.

## Product objective

IntentLock’s promise is **one purchase, one safe payment path—and a measured recovery attempt only when payment genuinely fails.** The local build simulates an IntentLock merchant console and shopper journey. The longer-term brief proposes an intent-level coordinator between merchant checkout and Razorpay: retain a stable merchant purchase reference, link all provider orders/attempts/events to it, reconcile provider state, and let a deterministic policy gate control any recovery action.

This is a hypothesis to validate with merchants. Do not claim the broader market has a universal duplicate-payment problem or that IntentLock has proven incremental recovery. The supplied source brief is titled **IntentLock Recovery Agent Track: AI Revenue Recovery** and is referenced in `README.md`.

## Critical safety rules

- The local provider is a **simulator**. Do not describe simulator events as signed webhooks, verified Razorpay events, live payment calls, real captures, or production behavior.
- Never let a browser callback/customer message move an intent to `Paid` or make it retry-eligible. In a real integration, only authenticated provider evidence plus reconciliation may establish payment state.
- Never allow a retry when an earlier attempt is unresolved. Retry requires a confirmed terminal failure, elapsed configured wait, and remaining retry budget.
- Retry approval is not payment submission. Starting the retry and incrementing counters only occurs after explicit customer checkout submission.
- Keep duplicate captures in `Review required`; do not send another fulfilment or automatically issue refunds.
- Recommendations are advisory only. Do not make the scorer mutate payment state, submit checkout, refund, or contact a customer.
- Fail closed on missing or conflicting evidence. Human review is appropriate for ambiguous/cross-order capture states.
- All UI seed data, chart values, evaluation baselines, and amounts derived from simulator state are synthetic. Keep them labeled as simulated. Do not invent AI quality, success probabilities, ROI, revenue lift, or merchant adoption.
- Current APIs have no authentication/authorization/tenant isolation and accept simulator-only state transitions. Do not expose them to the public internet or connect real payments without an explicit, separate security/product review.
- Never put secrets or real payment credentials in source, browser code, prompts, logs, README, or `.env.example`. `.env.local` is ignored and must stay untracked.

## Current code map

- `src/app/page.tsx` — merchant console and shopper checkout/status overlays. It includes navigation, payment/recovery filters, payment detail and timeline, scenario simulator, policy settings, experiments, and audit UI.
- `src/app/globals.css`, `src/app/overrides.css` — established visual design. Keep the polished Razorpay-inspired payments-operations layout and IntentLock brand. Do not copy proprietary logos/assets or make the UI imply it is Razorpay.
- `src/app/layout.tsx` — shell and metadata.
- `src/lib/domain.ts` — `Intent`, `Status`, `IntentEvent`, `LocalStore`, seed data, `decideRetry`, `decideAttemptStart`, `scoreRecoveryAction`, `hasProviderEvent`, `findReferenceIntent`, and `assertIntentInvariant`.
- `src/lib/store.ts` — `DATABASE_URL` selects PostgreSQL; otherwise atomic local JSON. PostgreSQL currently uses one singleton JSONB aggregate row with a `FOR UPDATE` transaction lock, not normalized tables. PostgreSQL code has not yet been run against a real database.
- `src/lib/evaluation.ts` — 11 deterministic checks that call shared domain helpers. Baseline counts 4 and 2 are fixed modeled comparisons, not measured data.
- `src/app/api/intents/route.ts` — intent list and idempotent create.
- `src/app/api/intents/[id]/actions/route.ts` — simulator transitions for `retry`, `attempt_started`, `failure`, `capture`, `delayed_capture`, and `duplicate_capture`.
- `src/app/api/policies/route.ts` — policy GET/PUT.
- `src/app/api/evaluation/route.ts` — scenario evaluation.
- `src/app/api/health/route.ts` — storage health/mode/version.
- `compose.yaml`, `.env.example` — local-only optional PostgreSQL.

## Current status and caveats

Implemented in local simulator: unique purchase reference behavior, canonical synthetic order, attempt/retry tracking, server-side retry gate, simulated failure and capture resolution, delayed capture, duplicate capture review, event-ID deduplication, policy versioning, shopper status polling, merchant console, CSV exports, deterministic recommendations, and scenario evaluation.

Known unverified/incomplete items:

- The latest verification showed `npm run lint` and `npm run build` pass in local JSON mode; evaluation returned 11/11. Re-run verification after edits.
- Optional PostgreSQL has not been verified against a live DB; no Docker or `psql` was available during the previous session. Next recommended task is PostgreSQL end-to-end validation using `docker compose up -d db` if Docker exists.
- PostgreSQL stores one aggregate JSONB row. Do not call it the final normalized production schema. Consider migration only with a clear need and a tested migration plan.
- There is no live Razorpay SDK/API integration, signed webhook inbox, provider reconciliation request, Redis/BullMQ worker, authentication, merchant tenancy, customer messaging, refund action, or independently routable customer status URL.
- The “recovery AI” is currently transparent rule-based priority logic. No trained model or appropriate merchant labels/outcomes exist.
- There is no production or merchant pilot. Merchant discovery, shadow mode, security review, and measured pilot are future phases.
- `.intentlock/store.json` has already been changed during manual browser/API scenario verification and contains persistent sample/test activity. Preserve it; do not assume seed data is untouched.

## Suggested sequence

### Phase A — Verify storage (next)

1. Check whether Docker is installed and running. If available, start Compose PostgreSQL. If not, report that clearly and continue with tests that do not require a DB.
2. Verify schema bootstrap, initial state, create/update/read, policy persistence, app restart persistence, health success and failure, transaction rollback, and two concurrent updates. Confirm one version increment per successful mutation.
3. Check DB startup retry behavior, pool lifecycle, local JSON fallback, and TypeScript/lint/build. Fix defects before expanding architecture.
4. Do not migrate or delete existing `.intentlock` data. If a migration is proposed, back up and make it explicit/reversible.

### Phase B — Automated regression coverage

Add a focused test runner only after understanding the current package scripts and desired environment. Cover retry safety, attempt start, idempotent references, duplicate event IDs, policy versioning, late capture, duplicate capture/one-time fulfilment, storage adapter behavior, and rollback/concurrency where possible. Keep the visible scenario evaluation useful to operators, but do not confuse it with unit/integration tests.

### Phase C — Complete local shopper handoff

If appropriate, turn the current modal into a separately routable customer status URL with a non-guessable token, expiry, minimal customer data, and read-only status semantics. Do not expose arbitrary intent records by guessable ID. Keep retry submission behind the same server state gate. Avoid adding authentication/security theatre; design and verify actual access controls.

### Later, only with explicit prerequisites

- Razorpay test-mode integration requires credentials, API order mapping, raw-body signature verification, deduplicated durable webhook inbox, state reconciliation via provider API, and safe idempotency.
- Production state needs normalized tenant-aware intent/order/attempt/event/decision/action/outcome storage, actual DB uniqueness constraints, migrations, secret management, access control, observability, and disaster recovery.
- AI ranking requires a constrained action schema, real governed labels/outcomes, leakage-resistant split by merchant/time/scenario, safe baseline comparisons, calibration and safety metrics. Until then, retain the honest rule baseline.
- Shadow mode/pilot requires real merchant agreement/data, explicit review and security approval, a safe rollout and rollback plan, and real outcome measurement. Never manufacture revenue data.

## Verification workflow

For changes affecting code, run and report the checks that matter:

```bash
npm run lint
npm run build
```

For functional changes, exercise relevant API/UI flows as well. At minimum preserve these invariants:

1. A pending intent cannot be retried.
2. Failure evidence must exist; wait window and budget are rechecked server-side.
3. Approval alone does not increment attempts; checkout submission does.
4. A delayed capture resolves the same purchase and prevents an unsafe second path.
5. Duplicate provider events do not apply twice.
6. Multiple captures require review and do not cause a second fulfilment/refund.
7. Repeating the same purchase reference/amount does not create another intent; amount mismatch conflicts.
8. Policy/evaluation numbers are explicitly identified as synthetic/modeled.

If PostgreSQL is unavailable, do not claim PostgreSQL tests passed: report local JSON verification separately and leave PostgreSQL runtime verification open. Never silently skip a failed command or report a build as passing if output is incomplete.

## Working style and handoff

- Inspect before editing; do not rewrite working surfaces wholesale when a focused change will do.
- Keep the README accurate whenever architecture, route behavior, setup, or limitations change.
- Avoid adding unrelated integrations, dependencies, UI rebrands, fake analytics, or model claims.
- Preserve all existing local state unless the user specifically requests a reset.
- Complete a coherent phase before reporting. A passing build alone does not mean a product phase is complete.
- The user prefers minimal wait and wants the agent to continue through phases without requiring a fresh prompt after each one. Ask only for decisions that materially change scope, require unavailable credentials/data, or need explicit authorization.
- Final progress reports should distinguish verified behavior, implemented-but-unverified behavior, and future work. Mention any tests not run and why.
