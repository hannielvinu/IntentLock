import { NextResponse } from "next/server";
import { appendEvent, assertIntentInvariant, decideAttemptStart, decideRetry, hasProviderEvent } from "@/lib/domain";
import { updateStore } from "@/lib/store";

export const runtime = "nodejs";
type Action = "retry" | "attempt_started" | "failure" | "capture" | "delayed_capture" | "duplicate_capture";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let body: { action?: Action; provider_event_id?: string; failure_occurred_at?: string; method?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (!body.action || !["retry", "attempt_started", "failure", "capture", "delayed_capture", "duplicate_capture"].includes(body.action)) return NextResponse.json({ error: "Unknown simulator action." }, { status: 400 });
  try {
    const { result } = await updateStore(store => {
      const intent = store.intents.find(item => item.id === id);
      if (!intent) throw Object.assign(new Error("Purchase intent was not found."), { status: 404 });
      const action = body.action!;

      if (["failure", "capture", "delayed_capture", "duplicate_capture"].includes(action) && body.provider_event_id) {
        if (hasProviderEvent(intent, body.provider_event_id)) return { intent, deduplicated: true as const };
      }

      if (action === "retry") {
        const decision = decideRetry(intent, store.retryLimit, store.waitMinutes);
        if (!decision.allowed) throw Object.assign(new Error(decision.reason), { status: 409 });
        if (intent.status === "Waiting to retry") {
          intent.status = "Recovery eligible";
          intent.note = "Confirmed failure wait period elapsed. A retry can now be approved.";
          appendEvent(intent, "Retry wait elapsed", "Provider-confirmed failure remained terminal through the configured wait window", "blue", "policy", undefined, undefined, store.policyVersion);
        }
        if (!intent.retryApproved) {
          intent.retryApproved = true;
          intent.note = `Policy approved retry ${intent.retryCount + 1} of ${store.retryLimit}. Payment has not started yet.`;
          appendEvent(intent, "Retry approved by policy gate", `Retry budget ${intent.retryCount} of ${store.retryLimit} used · previous failure confirmed · customer action required`, "blue", "policy", undefined, undefined, store.policyVersion);
        }
        assertIntentInvariant(intent);
        return { intent, deduplicated: false as const };
      }

      if (action === "attempt_started") {
        if (body.method && !["UPI", "Card", "Netbanking"].includes(body.method)) throw Object.assign(new Error("Unsupported simulated payment method."), { status: 400 });
        const startMode = decideAttemptStart(intent, store.retryLimit);
        if (startMode === "initial") {
          intent.attempts = 1;
        } else if (startMode === "retry") {
          intent.retryCount += 1;
          intent.attempts += 1;
          intent.retryApproved = false;
        } else {
          throw Object.assign(new Error("Payment cannot start while another attempt is unresolved or recovery is not approved."), { status: 409 });
        }
        if (body.method) intent.method = body.method;
        intent.status = "Payment pending";
        intent.note = "Payment attempt submitted. Waiting for verified provider confirmation.";
        appendEvent(intent, "Payment attempt started", `Customer submitted ${intent.method} checkout · attempt ${intent.attempts}`, "blue", "provider");
        assertIntentInvariant(intent);
        return { intent, deduplicated: false as const };
      }

      if (action === "failure") {
        if (intent.status !== "Payment pending" || intent.attempts === 0) throw Object.assign(new Error("A terminal failure can only resolve a submitted, unresolved payment attempt."), { status: 409 });
        const retryAvailable = intent.retryCount < store.retryLimit;
        const suppliedFailureTime = body.failure_occurred_at ? Date.parse(body.failure_occurred_at) : Date.now();
        if (!Number.isFinite(suppliedFailureTime) || suppliedFailureTime > Date.now()) throw Object.assign(new Error("Provider failure time must be a valid timestamp no later than now."), { status: 400 });
        intent.failureConfirmedAt = new Date(suppliedFailureTime).toISOString();
        const waitElapsed = Date.now() - suppliedFailureTime >= store.waitMinutes * 60_000;
        intent.retryApproved = false;
        intent.status = retryAvailable ? (waitElapsed ? "Recovery eligible" : "Waiting to retry") : "Failed";
        intent.note = retryAvailable ? (waitElapsed ? "Terminal failure verified. The configured wait has elapsed; a bounded retry is available." : "Terminal failure verified. Waiting for the configured retry delay.") : "Terminal failure verified. Retry limit reached; no further attempt is allowed.";
        appendEvent(intent, "Terminal failure confirmed", retryAvailable ? (waitElapsed ? "Verified provider failure · configured wait elapsed · retry budget available" : `Verified provider failure · ${store.waitMinutes}-minute wait begins`) : "Verified provider failure · retry budget exhausted", "amber", "provider", body.provider_event_id, intent.failureConfirmedAt, store.policyVersion);
        assertIntentInvariant(intent);
        return { intent, deduplicated: false as const };
      }

      if (action === "capture" || action === "delayed_capture") {
        if (intent.attempts === 0 || !["Payment pending", "Waiting to retry", "Recovery eligible", "Failed", "Paid", "Review required"].includes(intent.status)) throw Object.assign(new Error("Capture evidence cannot be applied without a submitted payment attempt."), { status: 409 });
        if (intent.status === "Paid" || intent.status === "Review required" || intent.capturedCount > 0) {
          intent.capturedCount += 1;
          if (intent.providerOrders.length === 1) intent.providerOrders.push(`order_Q${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`);
          intent.status = "Review required";
          intent.note = "Additional capture detected. Automatic fulfilment stopped and merchant review is required.";
          appendEvent(intent, "Additional capture detected", `An additional capture was recorded across linked provider orders (${intent.providerOrders.join(", ")}) · duplicate fulfilment prevented`, "red", "provider", body.provider_event_id);
        } else {
          intent.capturedCount = 1;
          intent.status = "Paid";
          intent.fulfilled = true;
          intent.retryApproved = false;
          intent.note = action === "delayed_capture" ? "Delayed provider capture reconciled. Retry was held and fulfilment released once." : "Provider capture verified. Fulfilment released exactly once.";
          appendEvent(intent, action === "delayed_capture" ? "Delayed capture reconciled" : "Capture verified", action === "delayed_capture" ? "Late provider success reconciled before any retry began · fulfilment released once" : "Provider capture confirmed · fulfilment released once", "green", "provider", body.provider_event_id, undefined, store.policyVersion);
        }
        assertIntentInvariant(intent);
        return { intent, deduplicated: false as const };
      }

      if (action === "duplicate_capture") {
        if (intent.attempts === 0) throw Object.assign(new Error("Duplicate capture simulation requires a submitted payment attempt."), { status: 409 });
        if (intent.status === "Paid") intent.capturedCount += 1;
        else intent.capturedCount = Math.max(intent.capturedCount, 0) + 2;
        if (intent.providerOrders.length === 1) intent.providerOrders.push(`order_Q${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`);
        intent.status = "Review required";
        intent.retryApproved = false;
        intent.note = "Multiple linked captures detected. Automatic fulfilment is held; merchant review is required.";
        appendEvent(intent, "Conflicting captures detected", `Multiple linked orders (${intent.providerOrders.join(", ")}) captured · duplicate fulfilment blocked · refund requires merchant action`, "red", "provider", body.provider_event_id, undefined, store.policyVersion);
        assertIntentInvariant(intent);
        return { intent, deduplicated: false as const };
      }
      throw Object.assign(new Error("Action could not be applied."), { status: 400 });
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = Number((error as { status?: number }).status) || 500;
    return NextResponse.json({ error: status === 500 ? "The payment state could not be updated." : (error as Error).message }, { status });
  }
}
