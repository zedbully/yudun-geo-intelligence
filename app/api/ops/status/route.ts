import { NextRequest, NextResponse } from "next/server";
import { exportEvidence } from "@/lib/server/evidence-ledger";
import {
  authorizeOperations,
  configuredProviders,
  readTechnicalAudits,
  YUDUN_SITES,
} from "@/lib/server/yudun-operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!authorizeOperations(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [audits, evidence] = await Promise.all([
    readTechnicalAudits(),
    exportEvidence(500),
  ]);
  const latestByDomain = Object.fromEntries(
    YUDUN_SITES.map((site) => [
      site.domain,
      [...audits].reverse().find((run) => run.domain === site.domain) ?? null,
    ]),
  );
  const evidenceByDomain = Object.fromEntries(
    YUDUN_SITES.map((site) => [
      site.domain,
      (evidence ?? []).filter((receipt) => receipt.site_domain === site.domain).length,
    ]),
  );
  const providers = configuredProviders();
  return NextResponse.json({
    schema: "yudun.geo.operations.status.v1",
    generatedAt: new Date().toISOString(),
    providers,
    providerCollectionBlocked: providers.length === 0,
    latestByDomain,
    evidenceByDomain,
    totalEvidence: evidence?.length ?? 0,
  });
}
