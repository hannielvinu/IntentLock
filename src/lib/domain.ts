export type Status = "Ready to pay" | "Paid" | "Payment pending" | "Waiting to retry" | "Recovery eligible" | "Review required" | "Failed";
export type EventTone = "blue" | "amber" | "red" | "green";
export type IntentEvent = { id: string; at: string; title: string; description: string; tone: EventTone; source: "merchant" | "provider" | "policy" | "system"; providerEventId?: string; policyVersion?: number };
export type Intent = {
  id: string; order: string; providerOrders: string[]; customer: string; email: string; amount: number; method: string;
  status: Status; time: string; attempts: number; retryCount: number; retryApproved: boolean;
  reference: string; note: string; capturedCount: number; fulfilled: boolean; failureConfirmedAt: string | null; events: IntentEvent[];
};
export type LocalStore = { intents: Intent[]; retryLimit: number; waitMinutes: number; policyVersion: number; version: number };

function event(id: string, minAgo: number, title: string, description: string, tone: EventTone, source: IntentEvent["source"]): IntentEvent {
  return { id, at: new Date(Date.now() - minAgo * 60_000).toISOString(), title, description, tone, source, policyVersion: 1 };
}
function seed(id: string, order: string, customer: string, email: string, amount: number, method: string, status: Status, minAgo: number, attempts: number, reference: string, note: string): Intent {
  const offset = minAgo;
  const providerOrders = status === "Review required" ? [order, `order_Q${id.slice(3, 10)}`] : [order];
  const events = [event(`${id}-created`, offset + 2, "Purchase intent created", "Canonical provider order linked to merchant purchase reference", "blue", "merchant")];
  if (attempts > 0) events.push(event(`${id}-attempt`, offset + 1, "Payment attempt started", `${method} checkout submitted · attempt ${attempts}`, "blue", "provider"));
  if (status === "Paid") events.push(event(`${id}-capture`, offset, "Capture verified", "Provider capture reconciled · fulfilment released once", "green", "provider"));
  else if (status === "Recovery eligible") events.push(event(`${id}-failure`, offset, "Terminal failure confirmed", "Provider reported terminal failure · wait elapsed · retry budget available", "amber", "provider"));
  else if (status === "Review required") events.push(event(`${id}-review`, offset, "Conflicting captures detected", `Linked orders ${providerOrders.join(", ")} captured · automatic fulfilment held`, "red", "policy"));
  else if (status === "Failed") events.push(event(`${id}-failure`, offset, "Terminal failure confirmed", "Retry budget exhausted or retry window closed", "amber", "provider"));
  else events.push(event(`${id}-pending`, offset, "Awaiting provider confirmation", "Payment unresolved · retry blocked by policy", "amber", "system"));
  return { id, order, providerOrders, customer, email, amount, method, status, time: `${minAgo} min ago`, attempts, retryCount: 0, retryApproved: false, reference, note, capturedCount: status === "Paid" ? 1 : status === "Review required" ? 2 : 0, fulfilled: status === "Paid", failureConfirmedAt: status === "Recovery eligible" ? new Date(Date.now() - minAgo * 60_000).toISOString() : null, events };
}

export const initialIntents: Intent[] = [
  seed("in_8f3a2c91", "order_Qx8k2Pm7", "Aarav Mehta", "aarav.m@example.com", 12499, "UPI", "Payment pending", 2, 1, "ORD-2026-1842", "Payment confirmation is taking longer than usual."),
  seed("in_7e1b6d44", "order_Qx6m9Ln2", "Priya Sharma", "priya.s@example.com", 4299, "Card ···· 4242", "Recovery eligible", 8, 1, "ORD-2026-1841", "Provider confirmed terminal failure. One retry is permitted."),
  seed("in_4c9a1f08", "order_Qw9v3Rt5", "Kabir Nair", "kabir.n@example.com", 8750, "Netbanking", "Paid", 14, 1, "ORD-2026-1840", "Payment captured and verified."),
  seed("in_2d5f8a31", "order_Qw7u1Hs8", "Ananya Rao", "ananya.r@example.com", 2199, "UPI", "Review required", 26, 2, "ORD-2026-1839", "Two linked orders report captures. Fulfilment is held for review."),
  seed("in_9a3e7b16", "order_Qv8t6Wc4", "Rohan Iyer", "rohan.i@example.com", 6599, "Card ···· 8810", "Failed", 42, 1, "ORD-2026-1838", "Payment failed. Retry window has expired."),
  seed("in_1b6d4e92", "order_Qv5s2Fk9", "Meera Patel", "meera.p@example.com", 15990, "UPI", "Paid", 60, 1, "ORD-2026-1837", "Payment captured and verified."),
];

export const initialStore: LocalStore = { intents: initialIntents, retryLimit: 1, waitMinutes: 5, policyVersion: 1, version: 1 };

export function appendEvent(intent: Intent, title: string, description: string, tone: EventTone, source: IntentEvent["source"], providerEventId?: string, occurredAt?: string, policyVersion?: number): void {
  intent.events.push({ id: crypto.randomUUID(), at: occurredAt || new Date().toISOString(), title, description, tone, source, ...(providerEventId ? { providerEventId } : {}), ...(policyVersion ? { policyVersion } : {}) });
  intent.events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  intent.time = "just now";
}

export function decideRetry(intent: Pick<Intent, "status" | "retryCount" | "failureConfirmedAt">, retryLimit: number, waitMinutes: number, now = Date.now()): { allowed: boolean; waitRemainingSeconds: number; reason: string } {
  if (intent.status !== "Recovery eligible" && intent.status !== "Waiting to retry") return { allowed: false, waitRemainingSeconds: 0, reason: "Retry is blocked until a provider-confirmed terminal failure." };
  if (!intent.failureConfirmedAt || !Number.isFinite(Date.parse(intent.failureConfirmedAt))) return { allowed: false, waitRemainingSeconds: 0, reason: "Retry is blocked because failure evidence is missing." };
  const remaining = Math.max(0, Math.ceil((waitMinutes * 60_000 - (now - Date.parse(intent.failureConfirmedAt))) / 1000));
  if (remaining > 0) return { allowed: false, waitRemainingSeconds: remaining, reason: `Wait ${remaining} more seconds before retry eligibility.` };
  if (intent.retryCount >= retryLimit) return { allowed: false, waitRemainingSeconds: 0, reason: "Retry limit has been reached for this purchase." };
  return { allowed: true, waitRemainingSeconds: 0, reason: "The confirmed failure, wait window, and retry budget permit one customer action." };
}

export function decideAttemptStart(intent: Pick<Intent, "status" | "attempts" | "retryApproved" | "retryCount">, retryLimit: number): "initial" | "retry" | null {
  if (intent.status === "Ready to pay" && intent.attempts === 0) return "initial";
  if (intent.status === "Recovery eligible" && intent.retryApproved && intent.retryCount < retryLimit) return "retry";
  return null;
}

export type RecoveryRecommendation = { priority: number; action: string; reason: string };
export function scoreRecoveryAction(intent: Pick<Intent, "status" | "retryCount" | "failureConfirmedAt">, retryLimit: number, waitMinutes: number, now = Date.now()): RecoveryRecommendation {
  if (intent.status === "Review required") return { priority: 100, action: "Review capture evidence", reason: "Multiple captures require a merchant decision; fulfilment and refunds are never automated here." };
  if (intent.status === "Payment pending") return { priority: 90, action: "Reconcile provider status", reason: "Payment is unresolved, so another attempt must remain blocked." };
  if (intent.status === "Waiting to retry") {
    const decision = decideRetry(intent, retryLimit, waitMinutes, now);
    return { priority: 75, action: decision.allowed ? "Offer a bounded retry" : "Wait, then recheck provider state", reason: decision.reason };
  }
  if (intent.status === "Recovery eligible") {
    const decision = decideRetry(intent, retryLimit, waitMinutes, now);
    return decision.allowed
      ? { priority: 80, action: "Offer a bounded retry", reason: decision.reason }
      : { priority: 65, action: "Recheck recovery eligibility", reason: decision.reason };
  }
  if (intent.status === "Ready to pay") return { priority: 40, action: "Continue to checkout", reason: "No payment attempt has started for this purchase." };
  if (intent.status === "Failed") return { priority: 10, action: "No retry available", reason: "The terminal state or retry budget does not allow another attempt." };
  return { priority: 0, action: "No action required", reason: "Payment is captured and recorded." };
}

export function hasProviderEvent(intent: Pick<Intent, "events">, providerEventId: string): boolean {
  return intent.events.some(event => event.providerEventId === providerEventId);
}

export function findReferenceIntent(intents: Intent[], reference: string): Intent | undefined {
  return intents.find(intent => intent.reference === reference);
}

export function assertIntentInvariant(intent: Intent): void {
  if (intent.amount <= 0 || !Number.isFinite(intent.amount)) throw new Error("Intent amount must be a positive number.");
  if (!intent.providerOrders.length || intent.providerOrders[0] !== intent.order || new Set(intent.providerOrders).size !== intent.providerOrders.length) throw new Error("Each purchase must keep one canonical and uniquely linked provider-order list.");
  if (intent.status === "Paid" && (intent.capturedCount < 1 || !intent.fulfilled)) throw new Error("Paid intents require a verified capture and one fulfilment.");
  if (intent.capturedCount > 1 && intent.status !== "Review required") throw new Error("Multiple captures require merchant review.");
  if (intent.fulfilled && intent.status !== "Paid" && intent.status !== "Review required") throw new Error("Unpaid intents cannot be fulfilled.");
  if (intent.attempts < 0 || intent.retryCount < 0) throw new Error("Attempt counters cannot be negative.");
}
