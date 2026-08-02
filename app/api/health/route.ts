import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "yudun-geo-intelligence",
    evidenceLedger: Boolean(process.env.YUDUN_GEO_EVIDENCE_LEDGER_PATH),
    operationsLedger: Boolean(process.env.YUDUN_GEO_OPERATIONS_LEDGER_PATH),
  });
}
