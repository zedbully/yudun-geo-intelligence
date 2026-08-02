alter table public.geo_evidence_receipts
  add column if not exists site_domain text;

create index if not exists geo_evidence_receipts_site_domain_idx
  on public.geo_evidence_receipts (site_domain, captured_at desc);
