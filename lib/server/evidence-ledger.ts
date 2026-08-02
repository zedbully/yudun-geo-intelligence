import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { EvidenceClass, EvidenceReceipt, Provider } from "@/components/dashboard/types";
import { getServerSupabase } from "./supabase";

export type EvidenceInput = {
  provider: Provider;
  evidenceClass: EvidenceClass;
  channel: EvidenceReceipt["channel"];
  prompt: string;
  answer: string;
  sources: string[];
  raw: unknown;
  country?: string;
  model?: string;
  upstreamRequestId?: string;
  createdAt: string;
  siteDomain?: string;
};

type StoredEvidence = {
  id: string;
  provider: Provider;
  evidence_class: EvidenceClass;
  channel: EvidenceReceipt["channel"];
  prompt: string;
  answer: string;
  sources: string[];
  country: string | null;
  site_domain: string | null;
  model: string | null;
  upstream_request_id: string | null;
  content_sha256: string;
  raw_sha256: string;
  raw_payload: unknown;
  captured_at: string;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sha256(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function localLedgerPath() {
  return process.env.YUDUN_GEO_EVIDENCE_LEDGER_PATH?.trim();
}

async function appendLocalEvidence(row: StoredEvidence) {
  const path = localLedgerPath();
  if (!path) return false;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(row)}\n`, { encoding: "utf8", mode: 0o600 });
  return true;
}

async function readLocalEvidence(limit: number): Promise<StoredEvidence[] | null> {
  const path = localLedgerPath();
  if (!path) return null;
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return content
    .split("\n")
    .filter(Boolean)
    .slice(-limit)
    .reverse()
    .map((line) => JSON.parse(line) as StoredEvidence);
}

export async function recordEvidence(input: EvidenceInput): Promise<EvidenceReceipt> {
  const id = randomUUID();
  const contentSha256 = sha256({
    provider: input.provider,
    prompt: input.prompt,
    answer: input.answer,
    sources: input.sources,
    createdAt: input.createdAt,
  });
  const rawSha256 = sha256(input.raw);
  const supabase = getServerSupabase();

  const row: StoredEvidence = {
    id,
    provider: input.provider,
    evidence_class: input.evidenceClass,
    channel: input.channel,
    prompt: input.prompt,
    answer: input.answer,
    sources: input.sources,
    country: input.country ?? null,
    site_domain: input.siteDomain ?? null,
    model: input.model ?? null,
    upstream_request_id: input.upstreamRequestId ?? null,
    content_sha256: contentSha256,
    raw_sha256: rawSha256,
    raw_payload: input.raw,
    captured_at: input.createdAt,
  };

  let persisted = false;
  if (supabase) {
    const { error } = await supabase.from("geo_evidence_receipts").insert(row);
    if (error) throw new Error(`Evidence persistence failed: ${error.message}`);
    persisted = true;
  }
  if (await appendLocalEvidence(row)) persisted = true;

  return {
    id,
    evidenceClass: input.evidenceClass,
    channel: input.channel,
    contentSha256,
    rawSha256,
    persisted,
    upstreamRequestId: input.upstreamRequestId,
    model: input.model,
  };
}

export async function exportEvidence(limit: number) {
  const supabase = getServerSupabase();
  if (supabase) {
    const { data, error } = await supabase
      .from("geo_evidence_receipts")
      .select(
        "id,provider,evidence_class,channel,prompt,answer,sources,country,site_domain,model,upstream_request_id,content_sha256,raw_sha256,captured_at",
      )
      .order("captured_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Evidence export failed: ${error.message}`);
    return data;
  }

  const rows = await readLocalEvidence(limit);
  return (
    rows?.map((row) => ({
      id: row.id,
      provider: row.provider,
      evidence_class: row.evidence_class,
      channel: row.channel,
      prompt: row.prompt,
      answer: row.answer,
      sources: row.sources,
      country: row.country,
      site_domain: row.site_domain,
      model: row.model,
      upstream_request_id: row.upstream_request_id,
      content_sha256: row.content_sha256,
      raw_sha256: row.raw_sha256,
      captured_at: row.captured_at,
    })) ?? null
  );
}
