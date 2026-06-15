// Central registry of all Argument Analyzer label dictionaries.
// Each dictionary maps a label key to { display, short, cls }.
// `cls` is a Tailwind class string for the colored pill.

// Layer 1 - Verification (per fact)
export const LABEL_INFO = {
  true:         { display: 'True / Verified',         short: 'True',         cls: 'bg-emerald-100 text-emerald-700' },
  false:        { display: 'False / Not Factual',     short: 'False',        cls: 'bg-red-100 text-red-700' },
  partly_true:  { display: 'Partly True / Mixed',     short: 'Partly',       cls: 'bg-amber-100 text-amber-700' },
  unverifiable: { display: 'Unverifiable / Unproven', short: 'Unverifiable', cls: 'bg-slate-100 text-slate-700' },
  disputed:     { display: 'Disputed',                short: 'Disputed',     cls: 'bg-purple-100 text-purple-700' },
  outdated:     { display: 'Outdated',                short: 'Outdated',     cls: 'bg-orange-100 text-orange-700' }
}

// Layer 2 - Distortion (per verified-true fact)
export const DISTORTION_INFO = {
  exaggerated:     { display: 'Exaggerated',     short: 'Exaggerated',  cls: 'bg-rose-100 text-rose-700' },
  understated:     { display: 'Understated',     short: 'Understated',  cls: 'bg-sky-100 text-sky-700' },
  misleading:      { display: 'Misleading',      short: 'Misleading',   cls: 'bg-purple-100 text-purple-700' },
  cherry_picked:   { display: 'Cherry-picked',   short: 'Cherry-picked',cls: 'bg-amber-100 text-amber-700' },
  missing_context: { display: 'Missing Context', short: 'No Context',   cls: 'bg-orange-100 text-orange-700' },
  conflation:      { display: 'Conflation',      short: 'Conflation',   cls: 'bg-indigo-100 text-indigo-700' },
  undistorted:     { display: 'Undistorted',     short: 'Clean',        cls: 'bg-emerald-100 text-emerald-700' }
}

// Layer 3 - Logical fallacies (per passage)
export const FALLACY_INFO = {
  ad_hominem:           { display: 'Ad Hominem',           short: 'Ad Hominem',     cls: 'bg-red-100 text-red-700' },
  straw_man:            { display: 'Straw Man',            short: 'Straw Man',      cls: 'bg-rose-100 text-rose-700' },
  false_dilemma:        { display: 'False Dilemma',        short: 'False Dilemma',  cls: 'bg-orange-100 text-orange-700' },
  slippery_slope:       { display: 'Slippery Slope',       short: 'Slippery Slope', cls: 'bg-amber-100 text-amber-700' },
  appeal_to_authority:  { display: 'Appeal to Authority',  short: 'Authority',      cls: 'bg-yellow-100 text-yellow-700' },
  appeal_to_emotion:    { display: 'Appeal to Emotion',    short: 'Emotion',        cls: 'bg-pink-100 text-pink-700' },
  hasty_generalization: { display: 'Hasty Generalization', short: 'Hasty Gen.',     cls: 'bg-lime-100 text-lime-700' },
  post_hoc:             { display: 'Post Hoc / False Cause', short: 'Post Hoc',     cls: 'bg-teal-100 text-teal-700' },
  circular_reasoning:   { display: 'Circular Reasoning',   short: 'Circular',       cls: 'bg-cyan-100 text-cyan-700' },
  red_herring:          { display: 'Red Herring',          short: 'Red Herring',    cls: 'bg-sky-100 text-sky-700' },
  equivocation:         { display: 'Equivocation',         short: 'Equivocation',   cls: 'bg-violet-100 text-violet-700' },
  anecdotal:            { display: 'Anecdotal',            short: 'Anecdotal',      cls: 'bg-indigo-100 text-indigo-700' }
}

export const SEVERITY_INFO = {
  minor:    { display: 'Minor',    cls: 'bg-slate-100 text-slate-600' },
  moderate: { display: 'Moderate', cls: 'bg-amber-100 text-amber-700' },
  serious:  { display: 'Serious',  cls: 'bg-red-100 text-red-700' }
}

// Layer 4 - Evidence quality (per verified-true fact)
export const EVIDENCE_INFO = {
  primary_source:   { display: 'Primary source',   short: 'Primary',  cls: 'bg-emerald-100 text-emerald-700' },
  secondary_source: { display: 'Secondary source', short: 'Secondary',cls: 'bg-lime-100 text-lime-700' },
  vague_appeal:     { display: 'Vague appeal',     short: 'Vague',    cls: 'bg-amber-100 text-amber-700' },
  anecdote:         { display: 'Anecdote',         short: 'Anecdote', cls: 'bg-orange-100 text-orange-700' },
  no_support:       { display: 'No support',       short: 'None',     cls: 'bg-red-100 text-red-700' }
}

// Friendly layer names for the score card
export const LAYER_NAMES = {
  verification: 'Verification',
  distortion:   'Distortion',
  fallacies:    'Fallacies',
  evidence:     'Evidence',
  consistency:  'Consistency',
  steelmanning: 'Steelmanning'
}
