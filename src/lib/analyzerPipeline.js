// Runs the full Argument Analyzer pipeline for a single presentation.
// Layers are kicked off in parallel where their dependencies allow:
//
//   extract -> verify -> { distortion, evidence }
//           -> fallacies  (parallel)
//           -> steelman   (parallel)
//           -> consistency (parallel, needs facts)
//
// The orchestrator calls onProgress(layerKey, status, info?) so the UI can
// show live status. Status values: 'running' | 'done' | 'error'.

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

export const PIPELINE_LAYERS = [
  { key: 'extract',     label: 'Extract' },
  { key: 'verify',      label: 'Verify' },
  { key: 'fallacies',   label: 'Fallacies' },
  { key: 'distortion',  label: 'Distortion' },
  { key: 'evidence',    label: 'Evidence' },
  { key: 'consistency', label: 'Consistency' },
  { key: 'steelman',    label: 'Steelman' }
]

async function callFn(url, body) {
  const res = await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`${url.split('/').pop()} failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

// Wrap a layer step with progress reporting + error capture.
function withProgress(onProgress, key, fn) {
  return (async () => {
    onProgress(key, 'running')
    try {
      const result = await fn()
      onProgress(key, 'done')
      return result
    } catch (e) {
      onProgress(key, 'error', String(e.message || e))
      // Swallow so other parallel layers can keep running.
      return null
    }
  })()
}

export async function runFullAnalysis({ presentation, onProgress = () => {} }) {
  if (!presentation?.transcript) {
    for (const layer of PIPELINE_LAYERS) onProgress(layer.key, 'error', 'No transcript')
    return
  }
  const presentationId = presentation.id
  const transcript = presentation.transcript

  // --- Extract (must run first) ---
  const facts = await withProgress(onProgress, 'extract', async () => {
    const { facts: extracted } = await callFn(EXTRACT_FACTS_URL, { transcript })
    if (!extracted?.length) throw new Error('No facts extracted')
    await supabase.from('extracted_facts').delete().eq('presentation_id', presentationId)
    const rows = extracted.map((f, i) => ({
      presentation_id: presentationId,
      fact_text: f,
      ordinal: i
    }))
    const { data, error } = await supabase.from('extracted_facts').insert(rows).select()
    if (error) throw error
    return data
  })

  if (!facts) {
    // Extract failed; mark everything else errored.
    for (const layer of PIPELINE_LAYERS.slice(1)) onProgress(layer.key, 'error', 'Skipped (extract failed)')
    return
  }

  // --- Independent layers (kick off in parallel) ---
  const fallaciesPromise = withProgress(onProgress, 'fallacies', async () => {
    const { fallacies } = await callFn(DETECT_FALLACIES_URL, { transcript })
    await supabase.from('logical_fallacies').delete().eq('presentation_id', presentationId)
    if (fallacies?.length) {
      const rows = fallacies.map((f, i) => ({
        presentation_id: presentationId,
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
  })

  const steelmanPromise = withProgress(onProgress, 'steelman', async () => {
    const result = await callFn(ASSESS_STEELMAN_URL, { transcript })
    const { error } = await supabase
      .from('steelman_assessments')
      .upsert({
        presentation_id: presentationId,
        score: result.score,
        summary: result.summary,
        engaged_views: result.engaged_views,
        omitted_views: result.omitted_views,
        analyzed_at: new Date().toISOString()
      }, { onConflict: 'presentation_id' })
    if (error) throw error
  })

  const consistencyPromise = withProgress(onProgress, 'consistency', async () => {
    const { issues } = await callFn(CHECK_CONSISTENCY_URL, {
      transcript,
      facts: facts.map(f => f.fact_text)
    })
    await supabase.from('consistency_issues').delete().eq('presentation_id', presentationId)
    if (issues?.length) {
      const rows = issues.map((x, i) => ({
        presentation_id: presentationId,
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
  })

  // --- Verify (gates distortion + evidence) ---
  const verifyPromise = withProgress(onProgress, 'verify', async () => {
    const BATCH = 20
    for (let i = 0; i < facts.length; i += BATCH) {
      const batch = facts.slice(i, i + BATCH)
      const { results } = await callFn(VERIFY_FACTS_URL, { facts: batch.map(f => f.fact_text) })
      const now = new Date().toISOString()
      await Promise.all(batch.map((f, j) => {
        const r = results[j]; if (!r) return Promise.resolve()
        return supabase.from('extracted_facts')
          .update({ label: r.label, reasoning: r.reasoning, analyzed_at: now })
          .eq('id', f.id)
      }))
      // Update local facts so distortion/evidence see the new labels
      for (let j = 0; j < batch.length; j++) {
        if (results[j]) batch[j].label = results[j].label
      }
    }
  })

  // Chain dependent layers off verify; if verify errors, they still report 'error'
  const distortionPromise = (async () => {
    await verifyPromise
    return withProgress(onProgress, 'distortion', async () => {
      const verifiedTrue = facts.filter(f => f.label === 'true')
      if (verifiedTrue.length === 0) return  // nothing to analyze
      const BATCH = 15
      for (let i = 0; i < verifiedTrue.length; i += BATCH) {
        const batch = verifiedTrue.slice(i, i + BATCH)
        const { results } = await callFn(ANALYZE_DISTORTION_URL, {
          transcript,
          facts: batch.map(f => f.fact_text)
        })
        const now = new Date().toISOString()
        await Promise.all(batch.map((f, j) => {
          const r = results[j]; if (!r) return Promise.resolve()
          return supabase.from('extracted_facts').update({
            distortion_label: r.label,
            distortion_reasoning: r.reasoning,
            distortion_analyzed_at: now
          }).eq('id', f.id)
        }))
      }
    })
  })()

  const evidencePromise = (async () => {
    await verifyPromise
    return withProgress(onProgress, 'evidence', async () => {
      const verifiedTrue = facts.filter(f => f.label === 'true')
      if (verifiedTrue.length === 0) return
      const BATCH = 15
      for (let i = 0; i < verifiedTrue.length; i += BATCH) {
        const batch = verifiedTrue.slice(i, i + BATCH)
        const { results } = await callFn(ASSESS_EVIDENCE_URL, {
          transcript,
          facts: batch.map(f => f.fact_text)
        })
        const now = new Date().toISOString()
        await Promise.all(batch.map((f, j) => {
          const r = results[j]; if (!r) return Promise.resolve()
          return supabase.from('extracted_facts').update({
            evidence_quality_label: r.label,
            evidence_quality_reasoning: r.reasoning,
            evidence_quality_analyzed_at: now
          }).eq('id', f.id)
        }))
      }
    })
  })()

  await Promise.all([
    fallaciesPromise,
    steelmanPromise,
    consistencyPromise,
    distortionPromise,
    evidencePromise
  ])
}
