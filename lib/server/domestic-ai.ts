import type { EvidenceClass, Provider } from "@/components/dashboard/types";
import { fetchWithTimeout } from "./http";

export type DomesticProvider = Extract<
  Provider,
  | "baidu_ai_search"
  | "hunyuan_api"
  | "deepseek_api"
  | "doubao_api"
  | "qwen_api"
  | "kimi_api"
>;

type ProviderConfig = {
  apiKeyEnv: string;
  baseUrlEnv: string;
  modelEnv: string;
  defaultBaseUrl: string;
  defaultModel: string;
};

const CONFIG: Record<DomesticProvider, ProviderConfig> = {
  baidu_ai_search: {
    apiKeyEnv: "BAIDU_QIANFAN_API_KEY",
    baseUrlEnv: "BAIDU_AI_SEARCH_BASE_URL",
    modelEnv: "BAIDU_AI_SEARCH_MODEL",
    defaultBaseUrl: "https://qianfan.baidubce.com/v2/ai_search",
    defaultModel: "baidu_search_v2",
  },
  hunyuan_api: {
    apiKeyEnv: "HUNYUAN_API_KEY",
    baseUrlEnv: "HUNYUAN_BASE_URL",
    modelEnv: "HUNYUAN_MODEL",
    defaultBaseUrl: "https://tokenhub.tencentmaas.com/v1",
    defaultModel: "hy3-preview",
  },
  deepseek_api: {
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseUrlEnv: "DEEPSEEK_BASE_URL",
    modelEnv: "DEEPSEEK_MODEL",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
  },
  doubao_api: {
    apiKeyEnv: "DOUBAO_API_KEY",
    baseUrlEnv: "DOUBAO_BASE_URL",
    modelEnv: "DOUBAO_MODEL",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-seed-2-0-lite-260215",
  },
  qwen_api: {
    apiKeyEnv: "QWEN_API_KEY",
    baseUrlEnv: "QWEN_BASE_URL",
    modelEnv: "QWEN_MODEL",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen3.7-plus",
  },
  kimi_api: {
    apiKeyEnv: "KIMI_API_KEY",
    baseUrlEnv: "KIMI_BASE_URL",
    modelEnv: "KIMI_MODEL",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2.5",
  },
};

export function isDomesticProvider(provider: Provider): provider is DomesticProvider {
  return provider in CONFIG;
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function contentToText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      return typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function collectSourceUrls(value: unknown, depth = 0, found = new Set<string>()) {
  if (depth > 7 || value == null) return found;
  if (typeof value === "string") {
    for (const match of value.match(/https?:\/\/[^\s)\]}>'\"]+/g) ?? []) {
      try {
        const parsed = new URL(match.replace(/[),.;:!?]+$/, ""));
        parsed.hash = "";
        found.add(parsed.toString());
      } catch {
        // Ignore malformed upstream citation values.
      }
    }
    return found;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectSourceUrls(entry, depth + 1, found);
    return found;
  }
  if (typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectSourceUrls(entry, depth + 1, found);
    }
  }
  return found;
}

export type DomesticAiResult = {
  provider: DomesticProvider;
  prompt: string;
  answer: string;
  sources: string[];
  createdAt: string;
  evidenceClass: EvidenceClass;
  model: string;
  upstreamRequestId?: string;
  raw: unknown;
};

export async function runDomesticAi(
  provider: DomesticProvider,
  prompt: string,
): Promise<DomesticAiResult> {
  const config = CONFIG[provider];
  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`${provider} is not configured. Set ${config.apiKeyEnv}.`);
  }

  const baseUrl = process.env[config.baseUrlEnv] ?? config.defaultBaseUrl;
  const model = process.env[config.modelEnv] ?? config.defaultModel;
  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: "system",
        content:
          "你是品牌可见性研究助手。请用简体中文直接回答，不要猜测来源；只有上游确实返回可核验链接时才列出引用。",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    stream: false,
  };

  if (provider === "hunyuan_api" && process.env.HUNYUAN_ENABLE_SEARCH === "true") {
    Object.assign(body, {
      enable_enhancement: true,
      force_search_enhancement: true,
      citation: true,
      search_info: true,
    });
  }

  const response = await fetchWithTimeout(
    joinUrl(baseUrl, "chat/completions"),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    120_000,
  );

  const responseText = await response.text();
  let raw: unknown;
  try {
    raw = JSON.parse(responseText);
  } catch {
    raw = { text: responseText };
  }

  if (!response.ok) {
    throw new Error(`${provider} request failed (${response.status})`);
  }

  const record = raw as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = (choices[0] ?? {}) as Record<string, unknown>;
  const message = (firstChoice.message ?? {}) as Record<string, unknown>;
  const answer = contentToText(message.content ?? firstChoice.text);
  if (!answer) throw new Error(`${provider} returned no answer text`);

  const sources = [...collectSourceUrls(raw)];
  const grounded = sources.length > 0 &&
    (provider === "baidu_ai_search" || provider === "hunyuan_api");
  const responseRequestId = response.headers.get("x-request-id") ?? undefined;
  const bodyRequestId =
    typeof record.id === "string"
      ? record.id
      : typeof record.request_id === "string"
        ? record.request_id
        : undefined;

  return {
    provider,
    prompt,
    answer,
    sources,
    createdAt: new Date().toISOString(),
    evidenceClass: grounded ? "grounded_search_api" : "model_api",
    model,
    upstreamRequestId: responseRequestId ?? bodyRequestId,
    raw,
  };
}
