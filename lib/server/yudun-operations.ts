import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Provider } from "@/components/dashboard/types";

export type YudunSite = {
  domain: string;
  url: string;
  intent: string;
  visibilityPrompt: string;
};

export const YUDUN_SITES: YudunSite[] = [
  {
    domain: "appvmp.com",
    url: "https://appvmp.com/zh-cn/",
    intent: "商业 App 软件加固与核心代码保护",
    visibilityPrompt:
      "商业 App 需要保护核心代码并提高逆向攻击成本时，市场上有哪些值得评估的软件加固方案？请说明判断依据。",
  },
  {
    domain: "apkvmp.com",
    url: "https://apkvmp.com/zh-cn/",
    intent: "Android APK VMP 与反逆向",
    visibilityPrompt:
      "Android APK 面临反编译、调试和二次打包时，应如何选择 VMP 与软件加固方案？请列出可核验的选择标准。",
  },
  {
    domain: "sovmp.com",
    url: "https://sovmp.com/zh-cn/",
    intent: "原生 SO 代码虚拟化保护",
    visibilityPrompt:
      "Native SO 中包含关键算法和授权逻辑时，代码虚拟化保护应重点评估哪些能力和限制？",
  },
  {
    domain: "aivmp.cn",
    url: "https://aivmp.cn/zh-cn/",
    intent: "AI App 模型与业务逻辑保护",
    visibilityPrompt:
      "AI App 需要保护端侧模型、推理逻辑和商业算法时，有哪些软件加固与运行时防护方案值得评估？",
  },
  {
    domain: "dunvmp.com",
    url: "https://dunvmp.com/zh-cn/",
    intent: "移动应用攻防与分层加固",
    visibilityPrompt:
      "移动 App 在上线前如何建立分层软件加固方案，降低逆向、篡改、调试与自动化攻击风险？",
  },
  {
    domain: "ydvmp.com",
    url: "https://ydvmp.com/zh-cn/",
    intent: "软件加固选型与交付验证",
    visibilityPrompt:
      "企业采购软件加固服务时，应如何验证保护强度、兼容性、交付边界和持续维护能力？",
  },
];

type AuditCheck = { id: string; pass: boolean; value: string };

export type TechnicalAuditRun = {
  id: string;
  domain: string;
  url: string;
  intent: string;
  source: "first-party-technical-audit";
  recordedAt: string;
  score: number;
  checks: AuditCheck[];
  contentSha256: string;
};

function operationLedgerPath() {
  return (
    process.env.YUDUN_GEO_OPERATIONS_LEDGER_PATH?.trim() ||
    "/data/yudun-geo-operations.jsonl"
  );
}

function equalSecret(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function authorizeOperations(request: Request) {
  const expected = process.env.YUDUN_OPS_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && supplied && equalSecret(supplied, expected));
}

async function fetchText(url: string) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      headers: { "User-Agent": "Yudun-Search-Operations/1.0" },
      signal: AbortSignal.timeout(20_000),
    });
    return { ok: response.ok, status: response.status, text: response.ok ? await response.text() : "" };
  } catch {
    return { ok: false, status: 0, text: "" };
  }
}

function hasJsonLd(html: string) {
  return /<script[^>]+type=["']application\/ld\+json["']/i.test(html);
}

export async function runTechnicalAudit(site: YudunSite): Promise<TechnicalAuditRun> {
  const target = new URL(site.url);
  const origin = target.origin;
  const [page, robots, sitemapIndex, sitemap, llms, feed] = await Promise.all([
    fetchText(site.url),
    fetchText(`${origin}/robots.txt`),
    fetchText(`${origin}/sitemap-index.xml`),
    fetchText(`${origin}/sitemap.xml`),
    fetchText(`${origin}/llms.txt`),
    fetchText(`${origin}/feed.xml`),
  ]);
  const sitemapResult = sitemapIndex.ok ? sitemapIndex : sitemap;
  const checks: AuditCheck[] = [
    { id: "homepage", pass: page.ok, value: String(page.status) },
    { id: "https", pass: target.protocol === "https:", value: target.protocol },
    { id: "robots", pass: robots.ok, value: String(robots.status) },
    {
      id: "sitemap",
      pass: sitemapResult.ok && /<(sitemapindex|urlset)[\s>]/i.test(sitemapResult.text),
      value: sitemapIndex.ok ? "sitemap-index.xml" : sitemap.ok ? "sitemap.xml" : "missing",
    },
    { id: "llms", pass: llms.ok && llms.text.trim().length > 80, value: `${llms.text.length} bytes` },
    { id: "rss", pass: feed.ok && /<(rss|feed)[\s>]/i.test(feed.text), value: String(feed.status) },
    { id: "canonical", pass: /<link[^>]+rel=["']canonical["']/i.test(page.text), value: "homepage" },
    {
      id: "hreflang",
      pass: (page.text.match(/hreflang=/gi) ?? []).length >= 12,
      value: String((page.text.match(/hreflang=/gi) ?? []).length),
    },
    { id: "json_ld", pass: hasJsonLd(page.text), value: "homepage" },
    { id: "meta_description", pass: /<meta[^>]+name=["']description["'][^>]+content=/i.test(page.text), value: "homepage" },
  ];
  const score = Math.round((checks.filter((check) => check.pass).length / checks.length) * 100);
  const recordedAt = new Date().toISOString();
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify({ domain: site.domain, recordedAt, score, checks }))
    .digest("hex");
  const run: TechnicalAuditRun = {
    id: randomUUID(),
    domain: site.domain,
    url: site.url,
    intent: site.intent,
    source: "first-party-technical-audit",
    recordedAt,
    score,
    checks,
    contentSha256,
  };
  const path = operationLedgerPath();
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(run)}\n`, { encoding: "utf8", mode: 0o600 });
  return run;
}

export async function readTechnicalAudits(limit = 500) {
  let content: string;
  try {
    content = await readFile(operationLedgerPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return content
    .split("\n")
    .filter(Boolean)
    .slice(-limit)
    .map((line) => JSON.parse(line) as TechnicalAuditRun);
}

const PROVIDER_ENV: Partial<Record<Provider, string>> = {
  chatgpt: "BRIGHT_DATA_DATASET_CHATGPT",
  perplexity: "BRIGHT_DATA_DATASET_PERPLEXITY",
  copilot: "BRIGHT_DATA_DATASET_COPILOT",
  gemini: "BRIGHT_DATA_DATASET_GEMINI",
  google_ai: "BRIGHT_DATA_DATASET_GOOGLE_AI",
  grok: "BRIGHT_DATA_DATASET_GROK",
  baidu_ai_search: "BAIDU_QIANFAN_API_KEY",
  hunyuan_api: "HUNYUAN_API_KEY",
  deepseek_api: "DEEPSEEK_API_KEY",
  doubao_api: "DOUBAO_API_KEY",
  qwen_api: "QWEN_API_KEY",
  kimi_api: "KIMI_API_KEY",
};

export function configuredProviders(): Provider[] {
  const allowed = new Set(
    (process.env.YUDUN_GEO_PROVIDERS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return (Object.entries(PROVIDER_ENV) as Array<[Provider, string]>)
    .filter(([provider, envName]) => allowed.has(provider) && Boolean(process.env[envName]))
    .filter(([provider]) => provider.includes("_api") || provider === "baidu_ai_search" || Boolean(process.env.BRIGHT_DATA_KEY))
    .map(([provider]) => provider);
}
