# IntentLock

IntentLock is a local payment recovery console and customer checkout simulator. It links payment attempts to merchant purchase references, holds retries while payment state is unresolved, and routes conflicting captures to merchant review.

## Run locally

Requirements: Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The local simulator persists intents, attempts, linked provider orders, policy settings, and event history in `.intentlock/store.json`. Use **Run scenario** to generate provider-like events, **Create payment** to open the shopper checkout, and select a payment row to inspect its state, evidence, and available action. Payment data is synthetic and is never sent to a payment provider.

## What works in the local simulator

- Create purchase intents with idempotent merchant references and one canonical provider order.
- Search and filter the payment list; download a CSV snapshot.
- Inspect a purchase reference, one or more linked provider orders, policy decision, and append-only event timeline.
- Simulate confirmed failure, delayed success, successful capture, and duplicate capture.
- Hold retries while payment is unresolved; require a confirmed terminal failure, elapsed policy wait, and available retry budget before approval.
- Keep retry approval separate from payment submission; an attempt counter advances only after the shopper submits checkout.
- Configure and persist retry limits and wait windows; record the policy version used for decisions.
- Deduplicate repeated simulated provider events by provider event ID.
- Keep duplicate captures in a review state and prevent a second automatic fulfilment.
- Show a transparent urgency score and bounded next-step recommendation for each payment; recommendations never execute payment actions.
- Inspect recovery, integrations, retry policies, an append-only audit timeline, and deterministic scenario evaluation.
- Run reproducible checks for unresolved payments, missing failure evidence, active wait windows, exhausted budgets, late captures, duplicate captures, idempotency, and event deduplication.

## Product boundary

This local build uses an atomic local JSON store and a deterministic provider simulator. The store serializes writes for a single local process; it is not a multi-process or production database. Razorpay credentials, live payments, signed webhook verification, multi-user access, PostgreSQL, Redis workers, email or SMS recovery, and real merchant revenue measurement are not connected. Scenario evaluation exercises the same deterministic state-machine helpers as the local API; baseline comparisons are modeled safety cases, not empirical rates or measured revenue lift. There is no trained AI model or real merchant outcome data. The UI follows a familiar payments-operations dashboard layout while retaining IntentLock branding.

## Delivery phases

1. Problem and product boundaries — captured in the supplied recovery-agent brief.
2. Local identity/state simulator — implemented with server-side idempotent intent creation, bounded policy gate, payment event deduplication, reconciliation-style transitions, and durable local event history. PostgreSQL and signed webhooks remain for the next backend hardening pass.
3. Merchant and shopper experience — implemented as the responsive operations console, intent detail, and checkout.
4. Scenario and measurement surfaces — implemented as deterministic state-machine checks and clearly labeled synthetic local counts; no real-world measurement is claimed.
5. Recovery recommendations — implemented as a transparent deterministic priority score and bounded next-step recommendation. A learned ranking model remains deferred until there is appropriate labeled merchant outcome data.
6. Merchant shadow mode and pilot — requires a separate backend, security review, merchant agreement, and real provider integration.
