-- Casa Class -- Argument Analyzer schema.
-- Phase 1 (Fact Checker, layer 1): extracted_facts table with per-fact label.

create table if not exists public.extracted_facts (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references public.presentations(id) on delete cascade,
  fact_text text not null,
  ordinal integer not null default 0,           -- preserves extraction order
  label text,                                    -- 'true' | 'false' | 'partly_true' | 'unverifiable' | 'disputed' | 'outdated'
  reasoning text,                                -- Claude's explanation for the label
  sources text,                                  -- optional, free-text source notes (future use)
  extracted_at timestamptz not null default now(),
  analyzed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists extracted_facts_presentation_idx
  on public.extracted_facts (presentation_id, ordinal);

alter table public.extracted_facts enable row level security;

drop policy if exists extracted_facts_anon_all on public.extracted_facts;
create policy extracted_facts_anon_all on public.extracted_facts
  for all to anon using (true) with check (true);

alter publication supabase_realtime add table public.extracted_facts;
