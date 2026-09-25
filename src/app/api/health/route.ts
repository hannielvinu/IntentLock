import { NextResponse } from "next/server";
import { readStore, storageMode } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await readStore();
    return NextResponse.json({ status: "ok", storage: storageMode(), version: store.version }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable", storage: storageMode() }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
