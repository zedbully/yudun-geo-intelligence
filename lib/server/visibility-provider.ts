import type { Provider } from "@/components/dashboard/types";
import { runAiScraper, type BrightDataProvider } from "./brightdata-scraper";
import { isDomesticProvider, runDomesticAi } from "./domestic-ai";
import { recordEvidence } from "./evidence-ledger";

export async function runVisibilityProvider(input: {
  provider: Provider;
  prompt: string;
  requireSources?: boolean;
  country?: string;
}) {
  if (isDomesticProvider(input.provider)) {
    const result = await runDomesticAi(input.provider, input.prompt);
    const evidence = await recordEvidence({
      provider: input.provider,
      evidenceClass: result.evidenceClass,
      channel: "official-api",
      prompt: result.prompt,
      answer: result.answer,
      sources: result.sources,
      raw: result.raw,
      country: input.country,
      model: result.model,
      upstreamRequestId: result.upstreamRequestId,
      createdAt: result.createdAt,
    });
    return {
      provider: result.provider,
      prompt: result.prompt,
      answer: result.answer,
      sources: result.sources,
      createdAt: result.createdAt,
      cached: false,
      evidence,
    };
  }

  const result = await runAiScraper({
    ...input,
    provider: input.provider as BrightDataProvider,
  });
  const evidence = await recordEvidence({
    provider: input.provider,
    evidenceClass: "consumer_product_snapshot",
    channel: "consumer-ui",
    prompt: result.prompt,
    answer: result.answer,
    sources: result.sources,
    raw: result.raw,
    country: input.country,
    upstreamRequestId: result.snapshotId,
    createdAt: result.createdAt,
  });

  return {
    provider: result.provider,
    prompt: result.prompt,
    answer: result.answer,
    sources: result.sources,
    createdAt: result.createdAt,
    cached: result.cached,
    evidence,
  };
}
