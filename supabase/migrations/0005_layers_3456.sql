-- Casa Class -- Argument Analyzer Phase 1 Layers 3-6.
--   Layer 3 (logical fallacies):    new table logical_fallacies
--   Layer 4 (evidence quality):     columns added to extracted_facts
--   Layer 5 (internal consistency): new table consistency_issues
--   Layer 6 (steelmanning):         new table steelman_assessments (one row per presentation)

-- ---------- Layer 4: evidence quality on each verified-true fact ----------
alter table public.extracted_facts
  add column if not exists evidence_quality_label text,           -- 'primary_source' | 'secondary_source' | 'vague_appeal' | 'anecdote' | 'no_support'
  add column if not exists evidence_quality_reasoning text,
  add column if not exists evidence_quality_analyzed_at timestamptz;

-- ---------- Layer 3: logical_fallacies ----------
create table if not exists public.logical_fallacies (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references public.presentations(id) on delete cascade,
  passage_quote text not null,                                    -- the bit of transcript flagged
  fallacy_type text not null,                                     -- one of 12 categories (see edge function)
  severity text not null default 'moderate',                      -- 'minor' | 'moderate' | 'serious'
  explanation text,
  ordinal integer not null default 0,
  analyzed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists logical_fallacies_presentation_idx
  on public.logical_fallacies (presentation_id, ordinal);

alter table public.logical_fallacies enable row level security;
drop policy if exists logical_fallacies_anon_all on public.logical_fallacies;
create policy logical_fallacies_anon_all on public.logical_fallacies
  for all to anon using (true) with check (true);
alter publication supabase_realtime add table public.logical_fallacies;

-- ---------- Layer 5: consistency_issues ----------
create table if not exists public.consistency_issues (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references public.presentations(id) on delete cascade,
  description text not null,                                      -- what the contradiction is
  fact_a text,                                                    -- the first claim
  fact_b text,                                                    -- the conflicting claim
  severity text not null default 'moderate',
  ordinal integer not null default 0,
  analyzed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists consistency_issues_presentation_idx
  on public.consistency_issues (presentation_id, ordinal);

alter table public.consistency_issues enable row level security;
drop policy if exists consistency_issues_anon_all on public.consistency_issues;
create policy consistency_issues_anon_all on public.consistency_issues
  for all to anon using (true) with check (true);
alter publication supabase_realtime add table public.consistency_issues;

-- ---------- Layer 6: steelman_assessments (one row per presentation) ----------
create table if not exists public.steelman_assessments (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null unique references public.presentations(id) on delete cascade,
  score numeric not null default 0,                               -- 0.0 .. 1.0
  summary text,                                                    -- one-paragraph overall judgment
  engaged_views text,                                              -- which opposing views the speaker engaged
  omitted_views text,                                              -- which strong opposing views were missed
  analyzed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.steelman_assessments enable row level security;
drop policy if exists steelman_assessments_anon_all on public.steelman_assessments;
create policy steelman_assessments_anon_all on public.steelman_assessments
  for all to anon using (true) with check (true);
alter publication supabase_realtime add table public.steelman_assessments;
