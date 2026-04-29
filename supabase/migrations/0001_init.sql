-- Casa Class — initial schema
-- Truly-open access: anon role gets full read/write on every table.
-- (Switch to passcode/name-picker auth later by tightening policies.)

create extension if not exists "pgcrypto";

-- ---------- speakers ----------
create table if not exists public.speakers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  rotation_order integer,           -- nullable: guest speakers don't sit in rotation
  is_regular boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists speakers_rotation_idx
  on public.speakers (rotation_order)
  where rotation_order is not null;

-- ---------- presentations ----------
-- One row per scheduled or completed weekly meeting.
create table if not exists public.presentations (
  id uuid primary key default gen_random_uuid(),
  scheduled_date date not null unique,
  speaker_id uuid references public.speakers(id) on delete set null,
  topic_title text,
  topic_description text,
  transcript text,
  summary text,
  summary_generated_at timestamptz,
  status text not null default 'scheduled',  -- 'scheduled' | 'completed' | 'cancelled'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists presentations_date_idx
  on public.presentations (scheduled_date);

-- Auto-bump updated_at on row change.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists presentations_touch on public.presentations;
create trigger presentations_touch
  before update on public.presentations
  for each row execute function public.touch_updated_at();

-- ---------- resources ----------
-- Books, links, and other materials a presenter recommends.
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references public.presentations(id) on delete cascade,
  kind text not null default 'link',       -- 'book' | 'link' | 'other'
  title text not null,
  url text,
  notes text,
  added_by text,                            -- name only (no auth)
  created_at timestamptz not null default now()
);

create index if not exists resources_presentation_idx
  on public.resources (presentation_id);

-- ---------- questions ----------
-- Discussion questions captured during a meeting.
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references public.presentations(id) on delete cascade,
  question text not null,
  asked_by text,
  created_at timestamptz not null default now()
);

create index if not exists questions_presentation_idx
  on public.questions (presentation_id);

-- ---------- topic_suggestions ----------
-- Idea board for future programs. Anyone can add.
create table if not exists public.topic_suggestions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  suggested_speaker_id uuid references public.speakers(id) on delete set null,
  suggested_by text,
  status text not null default 'proposed',  -- 'proposed' | 'scheduled' | 'archived'
  votes integer not null default 0,
  created_at timestamptz not null default now()
);

-- =================================================================
--                 ROW LEVEL SECURITY (truly-open mode)
-- =================================================================
-- Every table has RLS on; the anon role (used by the PWA) has full access.
-- This is the "truly open" posture you chose. To lock things down later,
-- replace these with stricter policies.

alter table public.speakers           enable row level security;
alter table public.presentations      enable row level security;
alter table public.resources          enable row level security;
alter table public.questions          enable row level security;
alter table public.topic_suggestions  enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array['speakers','presentations','resources','questions','topic_suggestions']) loop
    execute format('drop policy if exists %I_anon_all on public.%I;', t, t);
    execute format(
      'create policy %I_anon_all on public.%I for all to anon using (true) with check (true);',
      t, t
    );
  end loop;
end $$;

-- =================================================================
--                          REALTIME
-- =================================================================
-- Enable realtime so all members see changes instantly.
alter publication supabase_realtime add table public.speakers;
alter publication supabase_realtime add table public.presentations;
alter publication supabase_realtime add table public.resources;
alter publication supabase_realtime add table public.questions;
alter publication supabase_realtime add table public.topic_suggestions;
