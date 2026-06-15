import { useState, useEffect } from 'react'
import { useTable } from '../hooks/useTable.js'
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
} from '../lib/supabase.js'
import { formatLong, formatShort } from '../lib/dates.js'
import {
  LABEL_INFO, DISTORTION_INFO, FALLACY_INFO, EVIDENCE_INFO, SEVERITY_INFO, LAYER_NAMES
} from '../lib/labels.js'
import {
  verificationScore, distortionScore, fallaciesScore,
  evidenceScore, consistencyScore, steelmanningScore,
  compositeScore, scoreToGrade, formatPct, DEFAULT_WEIGHTS
} from '../lib/scoring.js'

export { LABEL_INFO, DISTORTION_INFO, FALLACY_INFO, EVIDENCE_INFO } // re-export for other components

// Shared headers for edge function calls.
const FUNCTION_HEADERS = {
  'Content-Type':  'application/json',
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'apikey':        SUPABASE_ANON_KEY
}

async function callFn(url, body) {
  const res = await fetch(url, { method: 'POST', headers: FUNCTION_HEADERS, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`Function failed (${res.status}): ${await res.text()}`)
  return res.json()
}

export default function ArgumentAnalyzer() {
  const [mode, setMode] = useState('single')

  return (
    <div className="space-y-6">
      <section className="card">
        <h1 className="font-display text-2xl mb-1">Argument Analyzer</h1>
        <p className="text-sm text-ink/60 mb-3">
          Six layers of analysis -- verification, distortion, fallacies, evidence quality,
          internal consistency, and steelmanning -- combined into a composite score.
        </p>
        <div className="inline-flex gap-1 bg-sunrise-50 rounded-full p-1 border border-sunrise-200">
          <button
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              mode === 'single' ? 'bg-white text-sunrise-700 shadow-warm' : 'text-ink/60 hover:text-sunrise-700'
            }`}
            onClick={() => setMode('single')}
          >Single program</button>
          <button
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              mode === 'compare' ? 'bg-white text-sunrise-700 shadow-warm' : 'text-ink/60 hover:text-sunrise-700'
            }`}
            onClick={() => setMode('compare')}
          >Compare two programs</button>
        </div>
      </section>

      {mode === 'single' ? <SingleProgramView /> : <CompareProgramsView />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hooks for layers 3, 5, 6 (table-backed) and 6 (single-row)
// ---------------------------------------------------------------------------

function usePresentationAnalysis(presentationId) {
  const filter = presentationId ? { presentation_id: presentationId } : null

  const { rows: facts, refresh: refreshFacts }         = useTable('extracted_facts',   { orderBy: 'ordinal', filter })
  const { rows: fallacies, refresh: refreshFallacies } = useTable('logical_fallacies', { orderBy: 'ordinal', filter })
  const { rows: issues, refresh: refreshIssues }       = useTable('consistency_issues',{ orderBy: 'ordinal', filter })

  const [steelman, setSteelman] = useState(null)
  const [steelmanLoaded, setSteelmanLoaded] = useState(false)

  async function refreshSteelman() {
    if (!presentationId) return
    const { data } = await supabase
      .from('steelman_assessments')
      .select('*')
      .eq('presentation_id', presentationId)
      .maybeSingle()
    setSteelman(data ?? null)
    setSteelmanLoaded(true)
  }

  useEffect(() => {
    setSteelmanLoaded(false)
    setSteelman(null)
    refreshSteelman()
    if (!presentationId) return
    const ch = supabase
      .channel(`steelman:${presentationId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'steelman_assessments', filter: `presentation_id=eq.${presentationId}` },
        () => refreshSteelman()
      )
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [presentationId])

  return {
    facts, refreshFacts,
    fallacies, refreshFallacies,
    issues, refreshIssues,
    steelman, refreshSteelman, steelmanLoaded
  }
}

function computeScores({ facts, fallacies, issues, steelman }) {
  return {
    verification: verificationScore(facts),
    distortion:   distortionScore(facts),
    fallacies:    fallaciesScore(fallacies),
    evidence:     evidenceScore(facts),
    consistency:  consistencyScore(issues),
    steelmanning: steelmanningScore(steelman)
  }
}

// ---------------------------------------------------------------------------
// Score card -- shown at the top of the workspace, and on the program page.
// ---------------------------------------------------------------------------

export function ScoreCard({ scores, compact = false }) {
  const composite = compositeScore(scores)
  const layers = [
    ['verification', LAYER_NAMES.verification, 'bg-emerald-500'],
    ['distortion',   LAYER_NAMES.distortion,   'bg-purple-500'],
    ['fallacies',    LAYER_NAMES.fallacies,    'bg-red-500'],
    ['evidence',     LAYER_NAMES.evidence,     'bg-amber-500'],
    ['consistency',  LAYER_NAMES.consistency,  'bg-sky-500'],
    ['steelmanning', LAYER_NAMES.steelmanning, 'bg-indigo-500']
  ]

  return (
    <section className={compact ? '' : 'card'}>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="text-5xl font-display leading-none">
            {composite ? scoreToGrade(composite.score) : '—'}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-ink/50">Composite</div>
            <div className="text-2xl font-display leading-none">
              {composite ? formatPct(composite.score) : 'Not yet analyzed'}
            </div>
          </div>
        </div>
        <div className="flex-1 min-w-[14rem] grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {layers.map(([key, name, fill]) => {
            const s = scores[key]
            const has = typeof s === 'number'
            return (
              <div key={key} className="text-xs">
                <div className="flex justify-between text-ink/70">
                  <span>{name}</span>
                  <span className="font-mono">{has ? formatPct(s) : '—'}</span>
                </div>
                <div className="h-1.5 mt-0.5 rounded-full bg-sunrise-100 overflow-hidden">
                  {has && <div className={`h-full ${fill}`} style={{ width: (s * 100) + '%' }} />}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// SINGLE-PROGRAM MODE
// ---------------------------------------------------------------------------

function SingleProgramView() {
  const { rows: presentations } = useTable('presentations', { orderBy: 'scheduled_date', ascending: false })
  const { rows: speakers }      = useTable('speakers')
  const [selectedId, setSelectedId] = useState('')

  const selectable = presentations.filter(p => p.transcript && p.transcript.trim().length >= 50)
  const selected   = presentations.find(p => p.id === selectedId)

  return (
    <>
      <section className="card">
        <label className="label">Select a program</label>
        <select className="input" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          <option value="">— Choose a program with a transcript —</option>
          {selectable.map(p => {
            const sp = speakers.find(s => s.id === p.speaker_id)
            return (
              <option key={p.id} value={p.id}>
                {p.scheduled_date} · {p.topic_title || '(Untitled)'}{sp ? ` · ${sp.name}` : ''}
              </option>
            )
          })}
        </select>
        {selectable.length === 0 && (
          <div className="text-xs text-ink/60 mt-2">
            No transcripts yet. Add a transcript on a program's page first.
          </div>
        )}
      </section>

      {selected && <AnalyzerWorkspace key={selected.id} presentation={selected} speakers={speakers} />}
    </>
  )
}

function AnalyzerWorkspace({ presentation, speakers }) {
  const analysis = usePresentationAnalysis(presentation.id)
  const { facts, fallacies, issues, steelman } = analysis
  const scores = computeScores({ facts, fallacies, issues, steelman })

  const [busy, setBusy]   = useState('')
  const [error, setError] = useState('')

  const sp = speakers.find(s => s.id === presentation.speaker_id)
  const unverified            = facts.filter(f => !f.label)
  const verifiedTrue          = facts.filter(f => f.label === 'true')
  const undistortion          = verifiedTrue.filter(f => !f.distortion_label)
  const unevidenced           = verifiedTrue.filter(f => !f.evidence_quality_label)
  const fallaciesAnalyzed     = analysis.fallacies != null && analysis.fallacies !== undefined  // table will return [] if analyzed (we track via separate flag)
  // We don't have an explicit "analyzed" flag for layers 3/5; we treat presence of any row OR an explicit toggle as analyzed.
  // For UX, we just rely on the "Re-run" button always being available.

  function setOp(name) { setBusy(name); setError('') }
  function clearOp() { setBusy('') }
  function fail(e) { setError(String(e.message || e)); clearOp() }

  // --- Layer actions ---

  async function extractFacts() {
    if (!presentation.transcript) return fail({ message: 'No transcript.' })
    if (facts.length && !confirm(`Replace the ${facts.length} existing fact${facts.length === 1 ? '' : 's'}?`)) return
    setOp('extract')
    try {
      const { facts: extracted } = await callFn(EXTRACT_FACTS_URL, { transcript: presentation.transcript })
      if (!extracted?.length) throw new Error('Extracted no facts.')
      if (facts.length) await supabase.from('extracted_facts').delete().eq('presentation_id', presentation.id)
      const rows = extracted.map((f, i) => ({ presentation_id: presentation.id, fact_text: f, ordinal: i }))
      const { error: e } = await supabase.from('extracted_facts').insert(rows)
      if (e) throw e
      await analysis.refreshFacts()
      clearOp()
    } catch (e) { fail(e) }
  }

  async function verifyFacts() {
    if (!unverified.length) return fail({ message: 'All facts already labeled.' })
    setOp('verify')
    try {
      const BATCH = 20
      for (let i = 0; i < unverified.length; i += BATCH) {
        const batch = unverified.slice(i, i + BATCH)
        const { results } = await callFn(VERIFY_FACTS_URL, { facts: batch.map(f => f.fact_text) })
        const now = new Date().toISOString()
        await Promise.all(batch.map((f, j) => {
          const r = results[j]; if (!r) return Promise.resolve()
          return supabase.from('extracted_facts')
            .update({ label: r.label, reasoning: r.reasoning, analyzed_at: now }).eq('id', f.id)
        }))
      }
      await analysis.refreshFacts()
      clearOp()
    } catch (e) { fail(e) }
  }

  async function runDistortion() {
    if (!undistortion.length) return fail({ message: 'No verified-true facts to analyze.' })
    setOp('distortion')
    try {
      const BATCH = 15
      for (let i = 0; i < undistortion.length; i += BATCH) {
        const batch = undistortion.slice(i, i + BATCH)
        const { results } = await callFn(ANALYZE_DISTORTION_URL, {
          transcript: presentation.transcript,
          facts: batch.map(f => f.fact_text)
        })
        const now = new Date().toISOString()
        await Promise.all(batch.map((f, j) => {
          const r = results[j]; if (!r) return Promise.resolve()
          return supabase.from('extracted_facts').update({
            distortion_label: r.label, distortion_reasoning: r.reasoning, distortion_analyzed_at: now
          }).eq('id', f.id)
        }))
      }
      await analysis.refreshFacts()
      clearOp()
    } catch (e) { fail(e) }
  }

  async function runFallacies() {
    if (!presentation.transcript) return fail({ message: 'No transcript.' })
    setOp('fallacies')
    try {
      const { fallacies: found } = await callFn(DETECT_FALLACIES_URL, { transcript: presentation.transcript })
      // Replace existing fallacies for this presentation
      await supabase.from('logical_fallacies').delete().eq('presentation_id', presentation.id)
      if (found.length) {
        const rows = found.map((f, i) => ({
          presentation_id: presentation.id,
          passage_quote: f.passage_quote,
          fallacy_type: f.fallacy_type,
          severity: f.severity,
          explanation: f.explanation,
          ordinal: i,
          analyzed_at: new Date().toISOString()
        }))
        const { error: e } = await supabase.from('logical_fallacies').insert(rows)
        if (e) throw e
      }
      await analysis.refreshFallacies()
      clearOp()
    } catch (e) { fail(e) }
  }

  async function runEvidence() {
    if (!unevidenced.length) return fail({ message: 'No verified-true facts to evaluate.' })
    setOp('evidence')
    try {
      const BATCH = 15
      for (let i = 0; i < unevidenced.length; i += BATCH) {
        const batch = unevidenced.slice(i, i + BATCH)
        const { results } = await callFn(ASSESS_EVIDENCE_URL, {
          transcript: presentation.transcript,
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
      await analysis.refreshFacts()
      clearOp()
    } catch (e) { fail(e) }
  }

  async function runConsistency() {
    if (!facts.length) return fail({ message: 'Extract facts first.' })
    setOp('consistency')
    try {
      const { issues: found } = await callFn(CHECK_CONSISTENCY_URL, {
        transcript: presentation.transcript,
        facts: facts.map(f => f.fact_text)
      })
      await supabase.from('consistency_issues').delete().eq('presentation_id', presentation.id)
      if (found.length) {
        const rows = found.map((x, i) => ({
          presentation_id: presentation.id,
          description: x.description,
          fact_a: x.fact_a,
          fact_b: x.fact_b,
          severity: x.severity,
          ordinal: i,
          analyzed_at: new Date().toISOString()
        }))
        const { error: e } = await supabase.from('consistency_issues').insert(rows)
        if (e) throw e
      }
      await analysis.refreshIssues()
      clearOp()
    } catch (e) { fail(e) }
  }

  async function runSteelman() {
    if (!presentation.transcript) return fail({ message: 'No transcript.' })
    setOp('steelman')
    try {
      const result = await callFn(ASSESS_STEELMAN_URL, { transcript: presentation.transcript })
      const row = {
        presentation_id: presentation.id,
        score: result.score,
        summary: result.summary,
        engaged_views: result.engaged_views,
        omitted_views: result.omitted_views,
        analyzed_at: new Date().toISOString()
      }
      const { error: e } = await supabase
        .from('steelman_assessments')
        .upsert(row, { onConflict: 'presentation_id' })
      if (e) throw e
      await analysis.refreshSteelman()
      clearOp()
    } catch (e) { fail(e) }
  }

  async function updateFact(id, fields)  { await supabase.from('extracted_facts').update(fields).eq('id', id) }
  async function deleteFact(id)          { if (confirm('Delete this fact?')) await supabase.from('extracted_facts').delete().eq('id', id) }
  async function deleteFallacy(id)       { if (confirm('Delete this fallacy?')) await supabase.from('logical_fallacies').delete().eq('id', id) }
  async function deleteIssue(id)         { if (confirm('Delete this issue?')) await supabase.from('consistency_issues').delete().eq('id', id) }

  return (
    <>
      <section className="card-tint">
        <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'rgba(180,83,9,.8)' }}>
          {formatLong(presentation.scheduled_date)}
        </div>
        <h2 className="font-display text-2xl mt-1 leading-tight">
          {presentation.topic_title || <span className="text-ink/40">Untitled</span>}
        </h2>
        <div className="text-sm text-ink/70 mt-1">{sp?.name || 'Speaker not recorded'}</div>
      </section>

      <ScoreCard scores={scores} />

      {error && <div className="card text-sm text-red-600">{error}</div>}

      {/* Step 1: Extract */}
      <StepCard
        n={1} title="Extract facts"
        subtitle="Pulls atomic factual claims from the transcript."
        actionLabel={facts.length ? 'Re-extract' : 'Extract facts'}
        busy={busy === 'extract'} disabled={!presentation.transcript || busy !== ''}
        onAction={extractFacts}
      >
        {facts.length === 0
          ? <div className="text-sm text-ink/60">No facts yet.</div>
          : <div className="text-sm text-ink/70">{facts.length} fact{facts.length === 1 ? '' : 's'} extracted.</div>}
      </StepCard>

      {facts.length > 0 && (
        <StepCard
          n={2} title="Verify (layer 1)"
          subtitle="Labels each fact True / False / Partly true / etc."
          actionLabel={unverified.length === 0 ? 'All labeled' : `Verify ${unverified.length} unlabeled`}
          busy={busy === 'verify'} disabled={busy !== '' || unverified.length === 0}
          onAction={verifyFacts}
        >
          <LabelDistribution items={facts} info={LABEL_INFO} field="label" />
        </StepCard>
      )}

      {verifiedTrue.length > 0 && (
        <StepCard
          n={3} title="Distortion check (layer 2)"
          subtitle="How was each verified-true fact actually presented?"
          actionLabel={undistortion.length === 0 ? 'All analyzed' : `Analyze ${undistortion.length}`}
          busy={busy === 'distortion'} disabled={busy !== '' || undistortion.length === 0 || !presentation.transcript}
          onAction={runDistortion}
        >
          <LabelDistribution items={verifiedTrue.filter(f => f.distortion_label)} info={DISTORTION_INFO} field="distortion_label" />
        </StepCard>
      )}

      {presentation.transcript && (
        <StepCard
          n={4} title="Logical fallacies (layer 3)"
          subtitle="Scans the transcript for fallacious reasoning moves."
          actionLabel={fallacies.length === 0 ? 'Detect fallacies' : 'Re-run'}
          busy={busy === 'fallacies'} disabled={busy !== ''}
          onAction={runFallacies}
        >
          {fallacies.length === 0
            ? <div className="text-sm text-ink/60">Not yet analyzed (or none found).</div>
            : (
              <>
                <LabelDistribution items={fallacies} info={FALLACY_INFO} field="fallacy_type" />
                <FallacyList fallacies={fallacies} onDelete={deleteFallacy} />
              </>
            )}
        </StepCard>
      )}

      {verifiedTrue.length > 0 && (
        <StepCard
          n={5} title="Evidence quality (layer 4)"
          subtitle="What kind of support did the speaker offer for each verified fact?"
          actionLabel={unevidenced.length === 0 ? 'All analyzed' : `Analyze ${unevidenced.length}`}
          busy={busy === 'evidence'} disabled={busy !== '' || unevidenced.length === 0}
          onAction={runEvidence}
        >
          <LabelDistribution items={verifiedTrue.filter(f => f.evidence_quality_label)} info={EVIDENCE_INFO} field="evidence_quality_label" />
        </StepCard>
      )}

      {facts.length > 0 && (
        <StepCard
          n={6} title="Internal consistency (layer 5)"
          subtitle="Scans for self-contradictions across the talk."
          actionLabel={issues.length === 0 ? 'Check consistency' : 'Re-run'}
          busy={busy === 'consistency'} disabled={busy !== ''}
          onAction={runConsistency}
        >
          {issues.length === 0
            ? <div className="text-sm text-ink/60">Not yet analyzed (or none found).</div>
            : <ConsistencyList issues={issues} onDelete={deleteIssue} />}
        </StepCard>
      )}

      {presentation.transcript && (
        <StepCard
          n={7} title="Steelmanning (layer 6)"
          subtitle="Did the speaker engage the strongest opposing views?"
          actionLabel={steelman ? 'Re-assess' : 'Assess'}
          busy={busy === 'steelman'} disabled={busy !== ''}
          onAction={runSteelman}
        >
          {steelman ? <SteelmanDetails s={steelman} /> : <div className="text-sm text-ink/60">Not yet assessed.</div>}
        </StepCard>
      )}

      {facts.length > 0 && (
        <section className="card">
          <h2 className="font-display text-xl mb-3">All facts</h2>
          <ul className="divide-y divide-sunrise-100">
            {facts.map((f, idx) => (
              <FactRow key={f.id} fact={f} ordinal={idx + 1}
                onUpdate={(fields) => updateFact(f.id, fields)}
                onDelete={() => deleteFact(f.id)} />
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------------

function StepCard({ n, title, subtitle, actionLabel, onAction, busy, disabled, children }) {
  return (
    <section className="card">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div>
          <h2 className="font-display text-xl">Step {n} · {title}</h2>
          <div className="text-xs text-ink/60">{subtitle}</div>
        </div>
        <button className="btn-primary" onClick={onAction} disabled={disabled}>
          {busy ? 'Working…' : actionLabel}
        </button>
      </div>
      {children}
    </section>
  )
}

function LabelDistribution({ items, info, field }) {
  const counts = Object.fromEntries(Object.keys(info).map(k => [k, 0]))
  for (const it of items) {
    const v = it[field]
    if (v && counts.hasOwnProperty(v)) counts[v]++
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (total === 0) return <div className="text-sm text-ink/60">Nothing labeled yet.</div>
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(info).map(([k, meta]) => (
        counts[k] > 0 && (
          <span key={k} className={`pill ${meta.cls}`}>
            {meta.display}: {counts[k]}
          </span>
        )
      ))}
    </div>
  )
}

function FallacyList({ fallacies, onDelete }) {
  return (
    <ul className="divide-y divide-sunrise-100 mt-3">
      {fallacies.map(f => {
        const info = FALLACY_INFO[f.fallacy_type] || { display: f.fallacy_type, cls: 'bg-slate-100 text-slate-700' }
        const sev = SEVERITY_INFO[f.severity] || SEVERITY_INFO.moderate
        return (
          <li key={f.id} className="py-3">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`pill ${info.cls}`}>{info.display}</span>
                  <span className={`pill ${sev.cls}`}>{sev.display}</span>
                </div>
                <div className="text-sm italic text-ink/80 border-l-2 border-sunrise-200 pl-3 my-1">
                  "{f.passage_quote}"
                </div>
                {f.explanation && <div className="text-xs text-ink/70 mt-1">{f.explanation}</div>}
              </div>
              <button className="btn-ghost text-xs" onClick={() => onDelete(f.id)}>Remove</button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function ConsistencyList({ issues, onDelete }) {
  return (
    <ul className="divide-y divide-sunrise-100 mt-3">
      {issues.map(i => {
        const sev = SEVERITY_INFO[i.severity] || SEVERITY_INFO.moderate
        return (
          <li key={i.id} className="py-3">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`pill ${sev.cls}`}>{sev.display}</span>
                </div>
                <div className="text-sm">{i.description}</div>
                {(i.fact_a || i.fact_b) && (
                  <div className="text-xs text-ink/70 mt-2 grid sm:grid-cols-2 gap-2">
                    {i.fact_a && <div className="border-l-2 border-sunrise-200 pl-2"><div className="text-[10px] uppercase tracking-wider text-ink/50">Claim A</div>{i.fact_a}</div>}
                    {i.fact_b && <div className="border-l-2 border-sunrise-200 pl-2"><div className="text-[10px] uppercase tracking-wider text-ink/50">Claim B</div>{i.fact_b}</div>}
                  </div>
                )}
              </div>
              <button className="btn-ghost text-xs" onClick={() => onDelete(i.id)}>Remove</button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function SteelmanDetails({ s }) {
  return (
    <div className="text-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="pill bg-indigo-100 text-indigo-700">Steelman score: {formatPct(Number(s.score))}</span>
        {s.analyzed_at && <span className="text-[11px] text-ink/40">Assessed {new Date(s.analyzed_at).toLocaleString()}</span>}
      </div>
      {s.summary && <div className="mb-2">{s.summary}</div>}
      <div className="grid sm:grid-cols-2 gap-3">
        {s.engaged_views && (
          <div className="border-l-2 border-emerald-200 pl-3">
            <div className="text-[10px] uppercase tracking-wider text-ink/50 mb-1">Opposing views engaged</div>
            <div className="text-xs text-ink/80 whitespace-pre-wrap">{s.engaged_views}</div>
          </div>
        )}
        {s.omitted_views && (
          <div className="border-l-2 border-red-200 pl-3">
            <div className="text-[10px] uppercase tracking-wider text-ink/50 mb-1">Strong opposing views missed</div>
            <div className="text-xs text-ink/80 whitespace-pre-wrap">{s.omitted_views}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function FactRow({ fact, ordinal, onUpdate, onDelete }) {
  const [editingText, setEditingText]   = useState(false)
  const [draftText, setDraftText]       = useState(fact.fact_text)
  const info     = fact.label ? LABEL_INFO[fact.label] : null
  const distInfo = fact.distortion_label ? DISTORTION_INFO[fact.distortion_label] : null
  const evInfo   = fact.evidence_quality_label ? EVIDENCE_INFO[fact.evidence_quality_label] : null
  const showLayer2or4 = fact.label === 'true'

  function saveText() {
    const next = draftText.trim()
    if (next && next !== fact.fact_text) onUpdate({ fact_text: next })
    setEditingText(false)
  }

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <span className="text-xs text-ink/40 font-mono pt-0.5 w-6 text-right shrink-0">{ordinal}.</span>
        <div className="flex-1 min-w-0">
          {editingText ? (
            <textarea className="input text-sm" rows={2} value={draftText}
              onChange={(e) => setDraftText(e.target.value)} onBlur={saveText} autoFocus />
          ) : (
            <div className="text-sm cursor-text leading-relaxed"
              onClick={() => { setDraftText(fact.fact_text); setEditingText(true) }}
              title="Click to edit">
              {fact.fact_text}
            </div>
          )}

          {/* Layer 1: verification */}
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {info
              ? <span className={`pill ${info.cls}`}>{info.display}</span>
              : <span className="pill bg-sunrise-50 text-sunrise-700 border border-sunrise-200">Unlabeled</span>}
            <LabelPicker
              value={fact.label || ''} info={LABEL_INFO}
              onChange={(v) => onUpdate({ label: v || null, analyzed_at: v ? new Date().toISOString() : null })}
              placeholder="— change verification —"
            />
          </div>
          {fact.reasoning && <div className="text-xs text-ink/70 mt-1.5 leading-relaxed whitespace-pre-wrap">{fact.reasoning}</div>}

          {/* Layer 2 + Layer 4 visible only on verified-true facts */}
          {showLayer2or4 && (
            <div className="mt-3 pt-3 border-t border-sunrise-50 grid sm:grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-ink/40 mb-1">Distortion</div>
                <div className="flex items-center gap-2 flex-wrap">
                  {distInfo
                    ? <span className={`pill ${distInfo.cls}`}>{distInfo.display}</span>
                    : <span className="pill bg-sunrise-50 text-sunrise-700 border border-sunrise-200">Not analyzed</span>}
                  <LabelPicker
                    value={fact.distortion_label || ''} info={DISTORTION_INFO}
                    onChange={(v) => onUpdate({ distortion_label: v || null, distortion_analyzed_at: v ? new Date().toISOString() : null })}
                    placeholder="— change —"
                  />
                </div>
                {fact.distortion_reasoning && <div className="text-xs text-ink/70 mt-1 whitespace-pre-wrap">{fact.distortion_reasoning}</div>}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-ink/40 mb-1">Evidence quality</div>
                <div className="flex items-center gap-2 flex-wrap">
                  {evInfo
                    ? <span className={`pill ${evInfo.cls}`}>{evInfo.display}</span>
                    : <span className="pill bg-sunrise-50 text-sunrise-700 border border-sunrise-200">Not analyzed</span>}
                  <LabelPicker
                    value={fact.evidence_quality_label || ''} info={EVIDENCE_INFO}
                    onChange={(v) => onUpdate({ evidence_quality_label: v || null, evidence_quality_analyzed_at: v ? new Date().toISOString() : null })}
                    placeholder="— change —"
                  />
                </div>
                {fact.evidence_quality_reasoning && <div className="text-xs text-ink/70 mt-1 whitespace-pre-wrap">{fact.evidence_quality_reasoning}</div>}
              </div>
            </div>
          )}
        </div>
        <button className="btn-ghost text-xs" onClick={onDelete}>Remove</button>
      </div>
    </li>
  )
}

function LabelPicker({ value, info, onChange, placeholder }) {
  return (
    <select
      className="text-xs bg-transparent border-0 text-ink/60 underline cursor-pointer"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      <option value="">Clear label</option>
      {Object.entries(info).map(([k, v]) => (
        <option key={k} value={k}>{v.display}</option>
      ))}
    </select>
  )
}

// ---------------------------------------------------------------------------
// COMPARE MODE
// ---------------------------------------------------------------------------

function CompareProgramsView() {
  const { rows: presentations } = useTable('presentations', { orderBy: 'scheduled_date', ascending: false })
  const { rows: speakers }      = useTable('speakers')
  const [leftId, setLeftId]   = useState('')
  const [rightId, setRightId] = useState('')

  const analyzed = presentations.filter(p => p.transcript)

  function Picker({ value, onChange, label, exclude }) {
    return (
      <div>
        <label className="label">{label}</label>
        <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Choose a program —</option>
          {analyzed.filter(p => p.id !== exclude).map(p => {
            const sp = speakers.find(s => s.id === p.speaker_id)
            return (
              <option key={p.id} value={p.id}>
                {p.scheduled_date} · {p.topic_title || '(Untitled)'}{sp ? ` · ${sp.name}` : ''}
              </option>
            )
          })}
        </select>
      </div>
    )
  }

  return (
    <>
      <section className="card">
        <div className="grid sm:grid-cols-2 gap-3">
          <Picker value={leftId}  onChange={setLeftId}  label="Program A" exclude={rightId} />
          <Picker value={rightId} onChange={setRightId} label="Program B" exclude={leftId} />
        </div>
        <div className="text-xs text-ink/60 mt-3">
          Run as many layers as you'd like in single-program view first, then compare the scores side by side here.
        </div>
      </section>

      {leftId && rightId && (
        <div className="grid sm:grid-cols-2 gap-4">
          <ProgramStatsCard presentation={presentations.find(p => p.id === leftId)}  speakers={speakers} />
          <ProgramStatsCard presentation={presentations.find(p => p.id === rightId)} speakers={speakers} />
        </div>
      )}
    </>
  )
}

function ProgramStatsCard({ presentation, speakers }) {
  const analysis = usePresentationAnalysis(presentation?.id)
  if (!presentation) return null
  const scores = computeScores(analysis)
  const sp = speakers.find(s => s.id === presentation.speaker_id)

  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wider text-ink/50">{formatShort(presentation.scheduled_date)}</div>
      <h3 className="font-display text-lg leading-tight mt-1">
        {presentation.topic_title || <span className="text-ink/40">Untitled</span>}
      </h3>
      <div className="text-sm text-ink/70 mb-3">{sp?.name || 'Speaker not recorded'}</div>

      <ScoreCard scores={scores} compact />

      <div className="mt-4 grid grid-cols-2 gap-3 text-center">
        <Stat label="Facts" value={analysis.facts.length} />
        <Stat label="Fallacies" value={analysis.fallacies.length} />
        <Stat label="Consistency issues" value={analysis.issues.length} />
        <Stat label="Verified true" value={analysis.facts.filter(f => f.label === 'true').length} />
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="bg-sunrise-50 rounded-lg p-2">
      <div className="text-2xl font-display leading-none">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-ink/50 mt-1">{label}</div>
    </div>
  )
}
