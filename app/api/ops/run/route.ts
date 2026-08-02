import { NextRequest, NextResponse } from "next/server";
import { exportEvidence } from "@/lib/server/evidence-ledger";
import { runVisibilityProvider } from "@/lib/server/visibility-provider";
import {
  authorizeOperations,
  configuredProviders,
  readTechnicalAudits,
  runTechnicalAudit,
  YUDUN_SITES,
} from "@/lib/server/yudun-operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!authorizeOperations(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = request.nextUrl.searchParams.get("force") === "1";
  const freshnessWindowMs = 20 * 60 * 60 * 1000;
  const [auditHistory, evidenceHistory] = await Promise.all([
    readTechnicalAudits(),
    exportEvidence(500),
  ]);
  const latestAuditByDomain = new Map(
    auditHistory.map((audit) => [audit.domain, audit] as const),
  );
  const sitesToAudit = YUDUN_SITES.filter((site) => {
    if (force) return true;
    const latest = latestAuditByDomain.get(site.domain);
    return !latest || Date.now() - new Date(latest.recordedAt).getTime() >= freshnessWindowMs;
  });
  const audits = await Promise.all(sitesToAudit.map(runTechnicalAudit));
  const skippedAudits = YUDUN_SITES.filter(
    (site) => !sitesToAudit.some((candidate) => candidate.domain === site.domain),
  ).map((site) => site.domain);
  const providers = configuredProviders();
  const maxProviderRuns = Math.max(
    0,
    Number.parseInt(process.env.YUDUN_GEO_MAX_PROVIDER_RUNS ?? "6", 10) || 0,
  );
  const planned = YUDUN_SITES.flatMap((site) =>
    providers.map((provider) => ({ site, provider })),
  )
    .filter(({ site, provider }) => {
      if (force) return true;
      return !(evidenceHistory ?? []).some(
        (receipt) =>
          receipt.site_domain === site.domain &&
          receipt.provider === provider &&
          Date.now() - new Date(receipt.captured_at).getTime() < freshnessWindowMs,
      );
    })
    .slice(0, maxProviderRuns);
  const visibility = [];
  for (const { site, provider } of planned) {
    try {
      const result = await runVisibilityProvider({
        provider,
        prompt: site.visibilityPrompt,
        country: "CN",
        siteDomain: site.domain,
      });
      visibility.push({
        domain: site.domain,
        provider,
        status: "completed",
        evidenceId: result.evidence.id,
        persisted: result.evidence.persisted,
      });
    } catch (error) {
      visibility.push({
        domain: site.domain,
        provider,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    schema: "yudun.geo.operations.v1",
    operatedAt: new Date().toISOString(),
    audits,
    skippedAudits,
    visibility,
    visibilityBlocked: providers.length === 0,
    blocker: providers.length === 0 ? "No enabled GEO provider credentials are configured" : null,
  });
}
