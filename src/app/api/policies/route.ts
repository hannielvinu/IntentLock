import { NextResponse } from "next/server";
import { readStore, updateStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const store = await readStore();
  return NextResponse.json({ retryLimit: store.retryLimit, waitMinutes: store.waitMinutes, policyVersion: store.policyVersion, version: store.version }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  let body: { retryLimit?: number; waitMinutes?: number };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (!Number.isInteger(body.retryLimit) || body.retryLimit! < 0 || body.retryLimit! > 3) return NextResponse.json({ error: "retryLimit must be an integer from 0 to 3." }, { status: 400 });
  if (!Number.isInteger(body.waitMinutes) || body.waitMinutes! < 0 || body.waitMinutes! > 1440) return NextResponse.json({ error: "waitMinutes must be an integer from 0 to 1440." }, { status: 400 });
  const { store } = await updateStore(value => {
    if (value.retryLimit !== body.retryLimit || value.waitMinutes !== body.waitMinutes) value.policyVersion += 1;
    value.retryLimit = body.retryLimit!;
    value.waitMinutes = body.waitMinutes!;
  });
  return NextResponse.json({ retryLimit: store.retryLimit, waitMinutes: store.waitMinutes, policyVersion: store.policyVersion, version: store.version });
}
