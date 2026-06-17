// Argument Analyzer pipeline.
// Each layer is a standalone async function that mutates a per-program
// `state` object and returns a structured `summary` the UI can render.
// Layers lazy-fetch their prerequisites from the DB so they can be called
// individually (manual mode) or in sequence (orchestrators below).

import {
  supabase,
  EXTRACT_FACTS_URL,
  VERIFY_FACTS_URL,
  ANALYZE_DISTORTION_URL,
  DETECT_FALLACIES_URL,
  ASSESS_EVIDENCE_URL,
  CHECK_CONSISTENCY_URL,
  ASSESS_STEELMAN_URL,
  SUPABASE_ANON_KEY
} from './supabase.js'

const HEADERS = {
  'Content-Type':  'application/json',
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'apikey':        SUPABASE_ANON_KEY
}

async function callFn(url, body) {
  const res = await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`${url.split('/').pop()} failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

// Lazy-load facts for the presentation into state.facts (with current labels).
async function ensureFacts(presentation, state) {
  if (state.facts) return state.facts
  const { data, error } = await supabase
    .from('extracted_facts').select('*')
    .eq('presentation_id', presentation.id)
    .order('ordinal', { ascending: true })
  if (error) throw error
  state.facts = data || []
  return state.facts
}

// ---------------------------------------------------------------------------
// Layer implementations
// ---------------------------------------------------------------------------

async function layerExtract(presentation, state) {
  const { facts } = await callFn(EXTRACT_FACTS_URL, { transcript: presentation.transcript })
  if (!facts?.length) throw new Error('No facts extracted')
  await supabase.from('extracted_facts').delete().eq('presentation_id', presentation.id)
  const rows = facts.map((f, i) => ({
    presentation_id: presentation.id,
    fact_text: f,
    ordinal: i
  }))
  const { data, error } = await supabase.from('extracted_facts').insert(rows).select()
  if (error) throw error
  state.facts = data || []
  return { count: state.facts.length }
}

async function layerVerify(presentation, state) {
  const allFacts = await ensureFacts(presentation, state)
  // Only process facts the user hasn't excluded.
  const facts = allFacts.filter(f => !f.excluded)
  if (facts.length === 0) throw new Error('No active facts to verify (all excluded or none extracted)')
  const BATCH = 20
  const labels = {}
  for (let i = 0; i < facts.length; i += BATCH) {
    const batch = facts.slice(i, i + BATCH)
    const { results } = await callFn(VERIFY_FACTS_URL, { facts: batch.map(f => f.fact_text) })
    const now = new Date().toISOString()
    await Promise.all(batch.map((f, j) => {
      const r = results[j]; if (!r) return Promise.resolve()
      labels[r.label] = (labels[r.label] || 0) + 1
      f.label = r.label
      f.reasoning = r.reasoning
      return supabase.from('extracted_facts')
        .update({ label: r.label, reasoning: r.reasoning, analyzed_at: now })
        .eq('id', f.id)
    }))
  }
  return { total: facts.length, labels }
}

async function layerFallacies(presentation, state) {
  const { fallacies } = await callFn(DETECT_FALLACIES_URL, { transcript: presentation.transcript })
  await supabase.from('logical_fallacies').delete().eq('presentation_id', presentation.id)
  if (fallacies?.length) {
    const rows = fallacies.map((f, i) => ({
      presentation_id: presentation.id,
      passage_quote: f.passage_quote,
      fallacy_type: f.fallacy_type,
      severity: f.severity,
      explanation: f.explanation,
      ordinal: i,
      analyzed_at: new Date().toISOString()
    }))
    const { error } = await supabase.from('logical_fallacies').insert(rows)
    if (error) throw error
  }
  const types = {}
  const examples = []
  for (const f of (fallacies || [])) {
    types[f.fallacy_type] = (types[f.fallacy_type] || 0) + 1
    if (examples.length < 2) examples.push({ type: f.fallacy_type, quote: f.passage_quote })
  }
  state.fallacies = fallacies || []
  return { count: fallacies?.length || 0, types, examples }
}

async function layerDistortion(presentation, state) {
  const facts = await ensureFacts(presentation, state)
  const verified = facts.filter(f => !f.excluded && f.label === 'true')
  if (verified.length === 0) return { total: 0, labels: {}, skipped: true }
  const BATCH = 15
  const labels = {}
  for (let i = 0; i < verified.length; i += BATCH) {
    const batch = verified.slice(i, i + BATCH)
    const { results } = await callFn(ANALYZE_DISTORTION_URL, {
      transcript: presentation.transcript,
      facts: batch.map(f => f.fact_text)
    })
    const now = new Date().toISOString()
    await Promise.all(batch.map((f, j) => {
      const r = results[j]; if (!r) return Promise.resolve()
      labels[r.label] = (labels[r.label] || 0) + 1
      f.distortion_label = r.label
      return supabase.from('extracted_facts').update({
        distortion_label: r.label,
        distortion_reasoning: r.reasoning,
        distortion_analyzed_at: now
      }).eq('id', f.id)
    }))
  }
  return { total: verified.length, labels }
}

async function layerEvidence(presentation, state) {
  const facts = await ensureFacts(presentation, state)
  const verified = facts.filter(f => !f.excluded && f.label === 'true')
  if (verified.length === 0) return { total: 0, labels: {}, skipped: true }
  const BATCH = 15
  const labels = {}
  for (let i = 0; i < verified.length; i += BATCH) {
    const batch = verified.slice(i, i + BATCH)
    const { results } = await callFn(ASSESS_EVIDENCE_URL, {
      transcript: presentation.transcript,
      facts: batch.map(f => f.fact_text)
    })
    const now = new Date().toISOString()
    await Promise.all(batch.map((f, j) => {
      const r = results[j]; if (!r) return Promise.resolve()
      labels[r.label] = (labels[r.label] || 0) + 1
      f.evidence_quality_label = r.label
      return supabase.from('extracted_facts').update({
        evidence_quality_label: r.label,
        evidence_quality_reasoning: r.reasoning,
        evidence_quality_analyzed_at: now
      }).eq('id', f.id)
    }))
  }
  return { total: verified.length, labels }
}

async function layerConsistency(presentation, state) {
  const allFacts = await ensureFacts(presentation, state)
  const facts = allFacts.filter(f => !f.excluded)
  if (facts.length === 0) return { count: 0, examples: [] }
  const { issues } = await callFn(CHECK_CONSISTENCY_URL, {
    transcript: presentation.transcript,
    facts: facts.map(f => f.fact_text)
  })
  await supabase.from('consistency_issues').delete().eq('presentation_id', presentation.id)
  if (issues?.length) {
    const rows = issues.map((x, i) => ({
      presentation_id: presentation.id,
      description: x.description,
      fact_a: x.fact_a,
      fact_b: x.fact_b,
      severity: x.severity,
      ordinal: i,
      analyzed_at: new Date().toISOString()
    }))
    const { error } = await supabase.from('consistency_issues').insert(rows)
    if (error) throw error
  }
  const examples = (issues || []).slice(0, 2).map(i => ({ desc: i.description, severity: i.severity }))
  return { count: issues?.length || 0, examples }
}

async function layerSteelman(presentation, state) {
  const result = await callFn(ASSESS_STEELMAN_URL, { transcript: presentation.transcript })
  const { error } = await supabase
    .from('steelman_assessments')
    .upsert({
      presentation_id: presentation.id,
      score: result.score,
      summary: result.summary,
      engaged_views: result.engaged_views,
      omitted_views: result.omitted_views,
      analyzed_at: new Date().toISOString()
    }, { onConflict: 'presentation_id' })
  if (error) throw error
  return { score: result.score, summary: result.summary }
}

// ---------------------------------------------------------------------------
// Layer registry
// ---------------------------------------------------------------------------

const LAYER_DEFS = [
  { key: 'extract',     label: 'Extract',     fn: layerExtract },
  { key: 'verify',      label: 'Verify',      fn: layerVerify },
  { key: 'fallacies',   label: 'Fallacies',   fn: layerFallacies },
  { key: 'distortion',  label: 'Distortion',  fn: layerDistortion },
  { key: 'evidence',    label: 'Evidence',    fn: layerEvidence },
  { key: 'consistency', label: 'Consistency', fn: layerConsistency },
  { key: 'steelman',    label: 'Steelman',    fn: layerSteelman }
]

export const PIPELINE_LAYERS = LAYER_DEFS.map(({ key, label }) => ({ key, label }))

// ---------------------------------------------------------------------------
// Single-layer runner (manual mode)
// ---------------------------------------------------------------------------

/**
 * Run a single layer on a single presentation.
 * @param {Object} opts
 * @param {Object} opts.presentation
 * @param {string} opts.layerKey
 * @param {Object} [opts.state]  Optional carry-forward state. If absent the
 *                               layer lazy-fetches facts from the DB.
 * @returns {Promise<Object>} The layer's summary object.
 */
export async function runSingleLayer({ presentation, layerKey, state = {} }) {
  const layer = LAYER_DEFS.find(l => l.key === layerKey)
  if (!layer) throw new Error(`Unknown layer: ${layerKey}`)
  return layer.fn(presentation, state)
}

// ---------------------------------------------------------------------------
// Comparative orchestrator: layer-by-layer, A then B within each layer.
// ---------------------------------------------------------------------------

export async function runComparativeAnalysis({
  presA, presB,
  onLayerStart = () => {},
  onLayerResult = () => {},
  onLayerError = () => {}
}) {
  const states = { A: {}, B: {} }
  const presentations = { A: presA, B: presB }

  for (const layer of LAYER_DEFS) {
    for (const side of ['A', 'B']) {
      const pres = presentations[side]
      if (!pres) continue
      onLayerStart(side, layer.key)
      try {
        const summary = await layer.fn(pres, states[side])
        onLayerResult(side, layer.key, summary)
      } catch (e) {
        onLayerError(side, layer.key, String(e.message || e))
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Legacy parallel orchestrator (still exported for completeness).
// ---------------------------------------------------------------------------

export async function runFullAnalysis({ presentation, onProgress = () => {} }) {
  if (!presentation?.transcript) {
    for (const layer of LAYER_DEFS) onProgress(layer.key, 'error', 'No transcript')
    return
  }
  const state = {}

  function wrap(key, fn) {
    return (async () => {
      onProgress(key, 'running')
      try { const s = await fn(); onProgress(key, 'done', s); return s }
      catch (e) { onProgress(key, 'error', String(e.message || e)); return null }
    })()
  }

  const extractResult = await wrap('extract', () => layerExtract(presentation, state))
  if (!extractResult) {
    for (const k of ['verify','fallacies','distortion','evidence','consistency','steelman']) onProgress(k, 'error', 'Skipped')
    return
  }
  const verifyPromise = wrap('verify', () => layerVerify(presentation, state))
  const fallaciesPromise = wrap('fallacies', () => layerFallacies(presentation, state))
  const steelmanPromise = wrap('steelman', () => layerSteelman(presentation, state))
  const consistencyPromise = wrap('consistency', () => layerConsistency(presentation, state))
  await verifyPromise
  const distortionPromise = wrap('distortion', () => layerDistortion(presentation, state))
  const evidencePromise = wrap('evidence', () => layerEvidence(presentation, state))
  await Promise.all([fallaciesPromise, steelmanPromise, consistencyPromise, distortionPromise, evidencePromise])
}
