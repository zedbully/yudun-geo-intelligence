import type { EvidenceClass, Provider } from "@/components/dashboard/types";
import { fetchWithTimeout } from "./http";

export type DomesticProvider = Extract<
  Provider,
  | "baidu_ai_search"
  | "hunyuan_api"
  | "deepseek_api"
  | "doubao_api"
  | "qwen_api"
  | "ernie_api"
  | "glm_api"
  | "kimi_api"
>;

type ProviderConfig = {
  apiKeyEnv: string;
  baseUrlEnv: string;
  modelEnv: string;
  defaultBaseUrl: string;
  defaultModel: string;
  qianfanDefaultModel?: string;
};

const QIANFAN_BASE_URL = "https://qianfan.baidubce.com/v2";

const CONFIG: Record<DomesticProvider, ProviderConfig> = {
  baidu_ai_search: {
    apiKeyEnv: "BAIDU_QIANFAN_API_KEY",
    baseUrlEnv: "BAIDU_AI_SEARCH_BASE_URL",
    modelEnv: "BAIDU_AI_SEARCH_MODEL",
    defaultBaseUrl: "https://qianfan.baidubce.com/v2/ai_search",
    defaultModel: "deepseek-v4-pro",
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
    qianfanDefaultModel: "deepseek-v4-pro",
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
    qianfanDefaultModel: "qwen3.5-397b-a17b",
  },
  ernie_api: {
    apiKeyEnv: "ERNIE_API_KEY",
    baseUrlEnv: "ERNIE_BASE_URL",
    modelEnv: "ERNIE_MODEL",
    defaultBaseUrl: QIANFAN_BASE_URL,
    defaultModel: "ernie-5.1",
    qianfanDefaultModel: "ernie-5.1",
  },
  glm_api: {
    apiKeyEnv: "GLM_API_KEY",
    baseUrlEnv: "GLM_BASE_URL",
    modelEnv: "GLM_MODEL",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-5",
    qianfanDefaultModel: "glm-5.2",
  },
  kimi_api: {
    apiKeyEnv: "KIMI_API_KEY",
    baseUrlEnv: "KIMI_BASE_URL",
    modelEnv: "KIMI_MODEL",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2.5",
    qianfanDefaultModel: "kimi-k2.6",
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
  const directApiKey = process.env[config.apiKeyEnv];
  const qianfanApiKey = config.qianfanDefaultModel
    ? process.env.BAIDU_QIANFAN_API_KEY
    : undefined;
  const apiKey = directApiKey ?? qianfanApiKey;
  if (!apiKey) {
    throw new Error(
      `${provider} is not configured. Set ${config.apiKeyEnv}` +
        (config.qianfanDefaultModel ? " or BAIDU_QIANFAN_API_KEY." : "."),
    );
  }

  const usingQianfanGateway = !directApiKey && Boolean(qianfanApiKey);
  const baseUrl =
    process.env[config.baseUrlEnv] ??
    (usingQianfanGateway
      ? process.env.QIANFAN_BASE_URL || QIANFAN_BASE_URL
      : config.defaultBaseUrl);
  const model =
    process.env[config.modelEnv] ??
    (usingQianfanGateway
      ? config.qianfanDefaultModel || config.defaultModel
      : config.defaultModel);
  const messages =
    provider === "baidu_ai_search"
      ? [{ role: "user", content: prompt }]
      : [
          {
            role: "system",
            content:
              "你是品牌可见性研究助手。请用简体中文直接回答，不要猜测来源；只有上游确实返回可核验链接时才列出引用。",
          },
          { role: "user", content: prompt },
        ];
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.2,
    stream: false,
  };

  if (provider === "baidu_ai_search") {
    const searchTopK = Math.min(
      20,
      Math.max(
        1,
        Number.parseInt(process.env.BAIDU_AI_SEARCH_TOP_K || "10", 10) || 10,
      ),
    );
    Object.assign(body, {
      search_source:
        process.env.BAIDU_AI_SEARCH_SOURCE || "baidu_search_v2",
      resource_type_filter: [{ type: "web", top_k: searchTopK }],
      enable_deep_search:
        process.env.BAIDU_AI_SEARCH_DEEP_SEARCH !== "false",
      enable_followup_query: false,
    });
  }

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
