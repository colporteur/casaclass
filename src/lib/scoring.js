// Composite scoring for the Argument Analyzer.
//
// Each layer produces a per-program score in 0.0 - 1.0, OR returns null
// when the layer hasn't been run yet (so the composite can ignore it).
//
// The composite is a weighted average across whichever layers HAVE scores,
// with default weights re-normalized to sum to 1 over the available subset.

// Default weights. Drop a layer from this map to remove it from scoring.
export const DEFAULT_WEIGHTS = {
  verification: 0.30,
  distortion:   0.20,
  fallacies:    0.20,
  evidence:     0.15,
  consistency:  0.10,
  steelmanning: 0.05
}

// ----- Per-fact / per-item weight tables -----

const VERIFY_WEIGHT = {
  true:        1.0,
  partly_true: 0.5,
  disputed:    0.3,
  outdated:    0.2,
  false:       0.0
  // 'unverifiable' is intentionally excluded from the denominator
}

const DISTORTION_WEIGHT = {
  undistorted:     1.0,
  missing_context: 0.7,
  understated:     0.5,
  exaggerated:     0.5,
  conflation:      0.4,
  misleading:      0.3,
  cherry_picked:   0.3
}

const EVIDENCE_WEIGHT = {
  primary_source:   1.0,
  secondary_source: 0.8,
  vague_appeal:     0.4,
  anecdote:         0.3,
  no_support:       0.0
}

const SEVERITY_PENALTY = {
  minor:    1,
  moderate: 2,
  serious:  4
}

// Cap for the fallacy / consistency penalty -- accumulated penalty points
// at which the score floors at zero.
const FALLACY_PENALTY_CAP = 10
const CONSISTENCY_PENALTY_CAP = 8

// ----- Per-layer scorers -----

export function verificationScore(facts) {
  if (!facts?.length) return null
  let weightedSum = 0
  let denominator = 0
  for (const f of facts) {
    if (f.excluded) continue
    if (!f.label) continue
    if (f.label === 'unverifiable') continue
    denominator++
    weightedSum += (VERIFY_WEIGHT[f.label] ?? 0)
  }
  if (denominator === 0) return null
  return clamp01(weightedSum / denominator)
}

export function distortionScore(facts) {
  if (!facts?.length) return null
  const targets = facts.filter(f => !f.excluded && f.label === 'true' && f.distortion_label)
  if (targets.length === 0) return null
  const sum = targets.reduce((acc, f) => acc + (DISTORTION_WEIGHT[f.distortion_label] ?? 0), 0)
  return clamp01(sum / targets.length)
}

export function evidenceScore(facts) {
  if (!facts?.length) return null
  const targets = facts.filter(f => !f.excluded && f.label === 'true' && f.evidence_quality_label)
  if (targets.length === 0) return null
  const sum = targets.reduce((acc, f) => acc + (EVIDENCE_WEIGHT[f.evidence_quality_label] ?? 0), 0)
  return clamp01(sum / targets.length)
}

export function fallaciesScore(fallacies) {
  // Returns null only if the layer hasn't been run (no array passed).
  // An empty array means "ran, found none" -> perfect score.
  if (!Array.isArray(fallacies)) return null
  const penalty = fallacies.reduce((acc, f) => acc + (SEVERITY_PENALTY[f.severity] ?? SEVERITY_PENALTY.moderate), 0)
  return clamp01(1 - penalty / FALLACY_PENALTY_CAP)
}

export function consistencyScore(issues) {
  if (!Array.isArray(issues)) return null
  const penalty = issues.reduce((acc, i) => acc + (SEVERITY_PENALTY[i.severity] ?? SEVERITY_PENALTY.moderate), 0)
  return clamp01(1 - penalty / CONSISTENCY_PENALTY_CAP)
}

export function steelmanningScore(assessment) {
  if (!assessment) return null
  const s = Number(assessment.score)
  if (!Number.isFinite(s)) return null
  return clamp01(s)
}

// ----- Composite -----

/**
 * @param {Object} scores  { verification, distortion, fallacies, evidence, consistency, steelmanning }
 *                         Each value is a number in [0,1] or null.
 * @param {Object} [weights]  Override DEFAULT_WEIGHTS.
 * @returns {Object|null}   { score, breakdown: [{ key, score, weight, contribution }] } or null if none.
 */
export function compositeScore(scores, weights = DEFAULT_WEIGHTS) {
  const available = Object.keys(weights).filter(k => typeof scores[k] === 'number')
  if (available.length === 0) return null

  const totalWeight = available.reduce((acc, k) => acc + (weights[k] ?? 0), 0)
  if (totalWeight === 0) return null

  let composite = 0
  const breakdown = []
  for (const k of available) {
    const w = (weights[k] ?? 0) / totalWeight
    const s = scores[k]
    composite += w * s
    breakdown.push({ key: k, score: s, weight: w, contribution: w * s })
  }
  return { score: clamp01(composite), breakdown }
}

export function scoreToGrade(score) {
  if (typeof score !== 'number') return '—'
  if (score >= 0.93) return 'A'
  if (score >= 0.85) return 'A-'
  if (score >= 0.80) return 'B+'
  if (score >= 0.73) return 'B'
  if (score >= 0.67) return 'B-'
  if (score >= 0.60) return 'C+'
  if (score >= 0.53) return 'C'
  if (score >= 0.47) return 'C-'
  if (score >= 0.40) return 'D+'
  if (score >= 0.33) return 'D'
  return 'F'
}

export function formatPct(score) {
  if (typeof score !== 'number') return '—'
  return Math.round(score * 100) + '%'
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}
