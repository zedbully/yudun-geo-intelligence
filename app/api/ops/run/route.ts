import { NextRequest, NextResponse } from "next/server";
import { runVisibilityProvider } from "@/lib/server/visibility-provider";
import {
  authorizeOperations,
  configuredProviders,
  runTechnicalAudit,
  YUDUN_SITES,
} from "@/lib/server/yudun-operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!authorizeOperations(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const audits = await Promise.all(YUDUN_SITES.map(runTechnicalAudit));
  const providers = configuredProviders();
  const maxProviderRuns = Math.max(
    0,
    Number.parseInt(process.env.YUDUN_GEO_MAX_PROVIDER_RUNS ?? "6", 10) || 0,
  );
  const planned = YUDUN_SITES.flatMap((site) =>
    providers.map((provider) => ({ site, provider })),
  ).slice(0, maxProviderRuns);
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
    visibility,
    visibilityBlocked: providers.length === 0,
    blocker: providers.length === 0 ? "No enabled GEO provider credentials are configured" : null,
  });
}
