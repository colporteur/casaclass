-- Casa Class — add co-presenters to presentations.
-- Keeps the existing speaker_id as the "primary" presenter (the one in the rotation).
-- co_speaker_ids holds any additional co-presenters assigned to the same date.

alter table public.presentations
  add column if not exists co_speaker_ids uuid[] not null default array[]::uuid[];
