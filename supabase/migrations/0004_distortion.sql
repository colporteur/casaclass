-- Casa Class -- Argument Analyzer Phase 1 Layer 2: distortion of accurate facts.
-- Extends extracted_facts with a second analysis pass that only runs on
-- facts already labeled 'true' by the fact checker.

alter table public.extracted_facts
  add column if not exists distortion_label text,            -- 'exaggerated' | 'understated' | 'misleading' | 'cherry_picked' | 'missing_context' | 'conflation' | 'undistorted'
  add column if not exists distortion_reasoning text,
  add column if not exists distortion_analyzed_at timestamptz;
