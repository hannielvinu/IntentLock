import { NextResponse } from "next/server";
import { assertIntentInvariant, findReferenceIntent, type Intent } from "@/lib/domain";
import { readStore, updateStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const store = await readStore();
  return NextResponse.json(store, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  const input = body as Partial<{ purchase_ref: string; amount: number; currency: string; customer: string; email: string; method: string }>;
  const suppliedReference = input.purchase_ref?.trim();
  if (suppliedReference && suppliedReference.length > 80) return NextResponse.json({ error: "purchase_ref must be at most 80 characters." }, { status: 400 });
  const amount = input.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "amount must be a positive number." }, { status: 400 });
  if (input.currency && input.currency !== "INR") return NextResponse.json({ error: "The local simulator currently supports INR only." }, { status: 400 });
  try {
    const { result } = await updateStore(store => {
      const latestSequence = Math.max(1842, ...store.intents.map(x => Number(/^ORD-2026-(\d+)$/.exec(x.reference)?.[1] || 0)));
      const reference = suppliedReference || `ORD-2026-${latestSequence + 1}`;
      const existing = findReferenceIntent(store.intents, reference);
      if (existing) {
        if (existing.amount !== amount) throw Object.assign(new Error("This purchase_ref is already locked to a different amount."), { status: 409 });
        return { intent: existing, reused: true };
      }
      const id = `in_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
      const order = `order_Q${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
      const now = new Date().toISOString();
      const created: Intent = {
        id, order, providerOrders: [order],
        customer: input.customer?.trim() || "New customer", email: input.email?.trim() || "",
        amount, method: input.method?.trim() || "UPI", status: "Ready to pay", time: "just now",
        attempts: 0, retryCount: 0, retryApproved: false, reference, note: "Canonical order created. No payment attempt has been submitted yet.",
        capturedCount: 0, fulfilled: false, failureConfirmedAt: null,
        events: [{ id: crypto.randomUUID(), at: now, title: "Purchase intent created", description: "Unique merchant reference locked · canonical provider order created", tone: "blue", source: "merchant", policyVersion: store.policyVersion }],
      };
      assertIntentInvariant(created);
      store.intents.unshift(created);
      return { intent: created, reused: false };
    });
    return NextResponse.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    const status = Number((error as { status?: number }).status) || 500;
    return NextResponse.json({ error: status === 500 ? "Could not create purchase intent." : (error as Error).message }, { status });
  }
}
