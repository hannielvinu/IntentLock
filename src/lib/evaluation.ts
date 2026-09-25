import { assertIntentInvariant, decideAttemptStart, decideRetry, findReferenceIntent, hasProviderEvent, initialIntents, scoreRecoveryAction, type Intent } from "@/lib/domain";

export type EvaluationCase = { id: string; scenario: string; observedOutcome: string; gateDecision: string; safe: boolean };
export type EvaluationReport = { generatedAt: string; scenarioCount: number; passed: number; gateSafetyViolations: number; immediateRetryUnsafe: number; timerOnlyRetryUnsafe: number; cases: EvaluationCase[]; assumptions: string[] };

function clone(overrides: Partial<Intent>): Intent {
  return { ...structuredClone(initialIntents[0]), ...overrides };
}

export function runLocalEvaluation(): EvaluationReport {
  const now = Date.now();
  const pending = clone({ status: "Payment pending", failureConfirmedAt: null, retryCount: 0 });
  const noEvidence = clone({ status: "Waiting to retry", failureConfirmedAt: null });
  const waiting = clone({ status: "Waiting to retry", failureConfirmedAt: new Date(now - 60_000).toISOString() });
  const eligible = clone({ status: "Recovery eligible", failureConfirmedAt: new Date(now - 6 * 60_000).toISOString(), retryCount: 0 });
  const exhausted = clone({ status: "Recovery eligible", failureConfirmedAt: new Date(now - 6 * 60_000).toISOString(), retryCount: 1 });
  const cases: EvaluationCase[] = [];
  const add = (id: string, scenario: string, observedOutcome: string, gateDecision: string, safe: boolean) => cases.push({ id, scenario, observedOutcome, gateDecision, safe });

  const pendingRetry = decideRetry(pending, 1, 5, now);
  add("unresolved", "Unresolved payment cannot be retried", pendingRetry.reason, pendingRetry.allowed ? "retry allowed" : "retry blocked", !pendingRetry.allowed);
  const missingEvidence = decideRetry(noEvidence, 1, 5, now);
  add("missing-evidence", "Missing failure evidence blocks retry", missingEvidence.reason, missingEvidence.allowed ? "retry allowed" : "retry blocked", !missingEvidence.allowed);
  const activeWait = decideRetry(waiting, 1, 5, now);
  add("wait", "Configured wait is enforced", `${activeWait.waitRemainingSeconds}s remain`, activeWait.allowed ? "retry allowed" : "retry blocked", !activeWait.allowed && activeWait.waitRemainingSeconds > 0);
  const elapsedWait = decideRetry(eligible, 1, 5, now);
  add("eligible", "Confirmed failure after wait permits one approval", elapsedWait.reason, elapsedWait.allowed ? "approval allowed" : "approval blocked", elapsedWait.allowed);
  const retryBeforeApproval = decideAttemptStart({ ...eligible, retryApproved: false }, 1);
  const retryAfterApproval = decideAttemptStart({ ...eligible, retryApproved: true }, 1);
  add("approval", "Retry starts only after explicit approval", `without approval: ${retryBeforeApproval ?? "blocked"}; with approval: ${retryAfterApproval ?? "blocked"}`, !retryBeforeApproval && retryAfterApproval === "retry" ? "explicit approval required" : "approval gate invalid", !retryBeforeApproval && retryAfterApproval === "retry");
  const pendingRecommendation = scoreRecoveryAction(pending, 1, 5, now);
  add("recommendation", "Recovery recommendation respects the retry gate", `${pendingRecommendation.action} · priority ${pendingRecommendation.priority}`, pendingRecommendation.action === "Reconcile provider status" ? "reconcile; do not retry" : "unsafe retry recommendation", pendingRecommendation.action === "Reconcile provider status");
  const exhaustedDecision = decideRetry(exhausted, 1, 5, now);
  add("budget", "Retry budget cannot be exceeded", exhaustedDecision.reason, exhaustedDecision.allowed ? "retry allowed" : "retry blocked", !exhaustedDecision.allowed);

  const captured = clone({ status: "Paid", capturedCount: 1, fulfilled: true });
  try { assertIntentInvariant(captured); add("late-capture", "Verified capture yields one fulfilment", "Paid state has a capture and one fulfilment", "valid terminal state", true); }
  catch (error) { add("late-capture", "Verified capture yields one fulfilment", String(error), "invariant failed", false); }

  const duplicateBase = clone({ status: "Review required", capturedCount: 2, fulfilled: true });
  const duplicate = { ...duplicateBase, providerOrders: [duplicateBase.order, "order_eval_second"] };
  try { assertIntentInvariant(duplicate); add("duplicate-capture", "Multiple captures hold for review", "Two linked captures; one prior fulfilment remains recorded", "review required · no second fulfilment", true); }
  catch (error) { add("duplicate-capture", "Multiple captures hold for review", String(error), "invariant failed", false); }

  const eventIntent = clone({ events: [{ ...initialIntents[0].events[0], providerEventId: "evt_eval" }] });
  add("dedupe", "Repeated provider event is recognized", `duplicate detected: ${hasProviderEvent(eventIntent, "evt_eval")}`, hasProviderEvent(eventIntent, "evt_eval") ? "event deduplicated" : "event may repeat", hasProviderEvent(eventIntent, "evt_eval"));
  add("idempotency", "Purchase reference resolves to existing intent", `same intent returned: ${findReferenceIntent([eligible], eligible.reference)?.id === eligible.id}`, "reuse canonical intent", findReferenceIntent([eligible], eligible.reference)?.id === eligible.id);

  const passed = cases.filter(item => item.safe).length;
  return {
    generatedAt: new Date().toISOString(), scenarioCount: cases.length, passed, gateSafetyViolations: cases.length - passed,
    immediateRetryUnsafe: 4,
    timerOnlyRetryUnsafe: 2,
    cases,
    assumptions: [
      "Cases call the same pure retry, attempt-start, idempotency, deduplication, and invariant helpers used by the local API.",
      "Baseline counts enumerate cases an immediate-retry or timer-only policy would mishandle; they are not measured production rates.",
      "The suite verifies deterministic application rules only. It does not simulate network faults or establish recovery lift, revenue, or provider correctness."
    ]
  };
}
