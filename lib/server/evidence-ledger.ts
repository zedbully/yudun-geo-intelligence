import { createHash, randomUUID } from "node:crypto";
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

  let persisted = false;
  if (supabase) {
    const { error } = await supabase.from("geo_evidence_receipts").insert({
      id,
      provider: input.provider,
      evidence_class: input.evidenceClass,
      channel: input.channel,
      prompt: input.prompt,
      answer: input.answer,
      sources: input.sources,
      country: input.country ?? null,
      model: input.model ?? null,
      upstream_request_id: input.upstreamRequestId ?? null,
      content_sha256: contentSha256,
      raw_sha256: rawSha256,
      raw_payload: input.raw,
      captured_at: input.createdAt,
    });
    if (error) throw new Error(`Evidence persistence failed: ${error.message}`);
    persisted = true;
  }

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
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("geo_evidence_receipts")
    .select(
      "id,provider,evidence_class,channel,prompt,answer,sources,country,model,upstream_request_id,content_sha256,raw_sha256,captured_at",
    )
    .order("captured_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Evidence export failed: ${error.message}`);
  return data;
}
