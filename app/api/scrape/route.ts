import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runVisibilityProvider } from "@/lib/server/visibility-provider";

const InputSchema = z.object({
  provider: z.enum([
    "chatgpt",
    "perplexity",
    "copilot",
    "gemini",
    "google_ai",
    "grok",
    "baidu_ai_search",
    "hunyuan_api",
    "deepseek_api",
    "doubao_api",
    "qwen_api",
    "ernie_api",
    "glm_api",
    "kimi_api",
  ]),
  prompt: z.string().min(3),
  requireSources: z.boolean().optional(),
  country: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = InputSchema.parse(body);
    const result = await runVisibilityProvider(parsed);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
