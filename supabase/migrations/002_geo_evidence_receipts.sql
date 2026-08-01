create table if not exists public.geo_evidence_receipts (
  id uuid primary key,
  provider text not null,
  evidence_class text not null check (
    evidence_class in ('consumer_product_snapshot', 'grounded_search_api', 'model_api')
  ),
  channel text not null check (channel in ('consumer-ui', 'official-api')),
  prompt text not null,
  answer text not null,
  sources jsonb not null default '[]'::jsonb,
  country text,
  model text,
  upstream_request_id text,
  content_sha256 text not null check (length(content_sha256) = 64),
  raw_sha256 text not null check (length(raw_sha256) = 64),
  raw_payload jsonb not null,
  captured_at timestamptz not null,
  inserted_at timestamptz not null default now()
);

create index if not exists geo_evidence_receipts_captured_at_idx
  on public.geo_evidence_receipts (captured_at desc);
create index if not exists geo_evidence_receipts_provider_idx
  on public.geo_evidence_receipts (provider, captured_at desc);

alter table public.geo_evidence_receipts enable row level security;

create or replace function public.reject_geo_evidence_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'geo_evidence_receipts is append-only';
end;
$$;

drop trigger if exists geo_evidence_receipts_immutable
  on public.geo_evidence_receipts;
create trigger geo_evidence_receipts_immutable
before update or delete on public.geo_evidence_receipts
for each row execute function public.reject_geo_evidence_mutation();

comment on table public.geo_evidence_receipts is
  'Append-only GEO evidence. Access is service-role only; raw payloads are never exported to browsers.';
