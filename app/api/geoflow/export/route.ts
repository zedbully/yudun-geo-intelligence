import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exportEvidence } from "@/lib/server/evidence-ledger";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function GET(req: NextRequest) {
  const secret = process.env.GEOFLOW_EXPORT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "GEOFlow export is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { limit } = QuerySchema.parse({
      limit: req.nextUrl.searchParams.get("limit") ?? undefined,
    });
    const receipts = await exportEvidence(limit);
    if (!receipts) {
      return NextResponse.json({ error: "Evidence storage is not configured" }, { status: 503 });
    }
    return NextResponse.json({
      schema: "yudun.geo.evidence.v1",
      readOnly: true,
      exportedAt: new Date().toISOString(),
      receipts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
