-- Casa Class -- per-fact exclusion flag.
-- Facts marked excluded are skipped by all six analyzer layers and don't
-- count toward any layer's score, but stay visible in the UI (greyed out)
-- so users can include them again later.

alter table public.extracted_facts
  add column if not exists excluded boolean not null default false;
