import { NextResponse } from "next/server";
import { runLocalEvaluation } from "@/lib/evaluation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(runLocalEvaluation(), { headers: { "Cache-Control": "no-store" } });
}
