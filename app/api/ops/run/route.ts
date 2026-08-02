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
    Number.parseInt(process.env.YUDUN_GEO_MAX_PROVIDER_RUNS ?? "36", 10) || 0,
  );
  const latestEvidenceByPair = new Map<string, number>();
  for (const receipt of evidenceHistory ?? []) {
    const capturedAt = new Date(receipt.captured_at).getTime();
    const key = `${receipt.site_domain}:${receipt.provider}`;
    if (capturedAt > (latestEvidenceByPair.get(key) ?? 0)) {
      latestEvidenceByPair.set(key, capturedAt);
    }
  }
  const providerQueues = YUDUN_SITES.map((site, siteIndex) =>
    providers
      .map((provider, providerIndex) => ({
        site,
        provider,
        providerIndex,
        lastCapturedAt:
          latestEvidenceByPair.get(`${site.domain}:${provider}`) ?? 0,
      }))
      .filter(
        ({ lastCapturedAt }) =>
          force || Date.now() - lastCapturedAt >= freshnessWindowMs,
      )
      .sort((left, right) => {
        if (left.lastCapturedAt !== right.lastCapturedAt) {
          return left.lastCapturedAt - right.lastCapturedAt;
        }
        const leftOffset =
          (left.providerIndex - siteIndex + providers.length) % providers.length;
        const rightOffset =
          (right.providerIndex - siteIndex + providers.length) % providers.length;
        return leftOffset - rightOffset;
      }),
  );
  const planned: Array<{
    site: (typeof YUDUN_SITES)[number];
    provider: (typeof providers)[number];
  }> = [];
  while (planned.length < maxProviderRuns) {
    let added = false;
    for (const queue of providerQueues) {
      const candidate = queue.shift();
      if (!candidate) continue;
      planned.push({ site: candidate.site, provider: candidate.provider });
      added = true;
      if (planned.length >= maxProviderRuns) break;
    }
    if (!added) break;
  }
  const visibility = [];
  const providerConcurrency = Math.min(
    12,
    Math.max(
      1,
      Number.parseInt(
        process.env.YUDUN_GEO_PROVIDER_CONCURRENCY ?? "6",
        10,
      ) || 6,
    ),
  );
  for (let offset = 0; offset < planned.length; offset += providerConcurrency) {
    const batch = planned.slice(offset, offset + providerConcurrency);
    const batchResults = await Promise.all(
      batch.map(async ({ site, provider }) => {
        try {
          const result = await runVisibilityProvider({
            provider,
            prompt: site.visibilityPrompt,
            country: "CN",
            siteDomain: site.domain,
          });
          return {
            domain: site.domain,
            provider,
            status: "completed" as const,
            evidenceId: result.evidence.id,
            persisted: result.evidence.persisted,
          };
        } catch (error) {
          return {
            domain: site.domain,
            provider,
            status: "failed" as const,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }),
    );
    visibility.push(...batchResults);
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
