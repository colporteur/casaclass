import { useState } from 'react'
import { useTable } from '../hooks/useTable.js'
import {
  supabase,
  EXTRACT_FACTS_URL,
  VERIFY_FACTS_URL,
  ANALYZE_DISTORTION_URL,
  SUPABASE_ANON_KEY
} from '../lib/supabase.js'
import { formatLong, formatShort } from '../lib/dates.js'

// Fact-checker rubric (layer 1)
export const LABEL_INFO = {
  true:         { display: 'True / Verified',         short: 'True',         cls: 'bg-emerald-100 text-emerald-700' },
  false:        { display: 'False / Not Factual',     short: 'False',        cls: 'bg-red-100 text-red-700' },
  partly_true:  { display: 'Partly True / Mixed',     short: 'Partly',       cls: 'bg-amber-100 text-amber-700' },
  unverifiable: { display: 'Unverifiable / Unproven', short: 'Unverifiable', cls: 'bg-slate-100 text-slate-700' },
  disputed:     { display: 'Disputed',                short: 'Disputed',     cls: 'bg-purple-100 text-purple-700' },
  outdated:     { display: 'Outdated',                short: 'Outdated',     cls: 'bg-orange-100 text-orange-700' }
}

// Distortion rubric (layer 2)
export const DISTORTION_INFO = {
  exaggerated:     { display: 'Exaggerated',     short: 'Exaggerated',  cls: 'bg-rose-100 text-rose-700' },
  understated:     { display: 'Understated',     short: 'Understated',  cls: 'bg-sky-100 text-sky-700' },
  misleading:      { display: 'Misleading',      short: 'Misleading',   cls: 'bg-purple-100 text-purple-700' },
  cherry_picked:   { display: 'Cherry-picked',   short: 'Cherry-picked',cls: 'bg-amber-100 text-amber-700' },
  missing_context: { display: 'Missing Context', short: 'No Context',   cls: 'bg-orange-100 text-orange-700' },
  conflation:      { display: 'Conflation',      short: 'Conflation',   cls: 'bg-indigo-100 text-indigo-700' },
  undistorted:     { display: 'Undistorted',     short: 'Clean',        cls: 'bg-emerald-100 text-emerald-700' }
}

export default function ArgumentAnalyzer() {
  const [mode, setMode] = useState('single')  // 'single' | 'compare'

  return (
    <div className="space-y-6">
      <section className="card">
        <h1 className="font-display text-2xl mb-1">Argument Analyzer</h1>
        <p className="text-sm text-ink/60 mb-3">
          Phase 1: <span className="font-medium text-ink/80">Fact Checker</span> · Layer 1 verifies each claim,
          Layer 2 checks how accurate claims were presented. More phases will follow.
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
        <select
          className="input"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">— Choose a program with a transcript —</option>
          {selectable.map(p => {
            const sp = speakers.find(s => s.id === p.speaker_id)
            const title = p.topic_title || '(Untitled)'
            return (
              <option key={p.id} value={p.id}>
                {p.scheduled_date} · {title}{sp ? ` · ${sp.name}` : ''}
              </option>
            )
          })}
        </select>
        {selectable.length === 0 && (
          <div className="text-xs text-ink/60 mt-2">
            No transcripts yet. Add a transcript on a program's page first, then come back here.
          </div>
        )}
      </section>

      {selected && <AnalyzerWorkspace key={selected.id} presentation={selected} speakers={speakers} />}
    </>
  )
}

function AnalyzerWorkspace({ presentation, speakers }) {
  const { rows: facts, refresh } = useTable('extracted_facts', {
    orderBy: 'ordinal',
    filter: { presentation_id: presentation.id }
  })

  const [busy, setBusy]   = useState('')   // '' | 'extract' | 'verify' | 'distortion'
  const [error, setError] = useState('')

  const sp = speakers.find(s => s.id === presentation.speaker_id)
  const unverified = facts.filter(f => !f.label)
  const verifiedTrue = facts.filter(f => f.label === 'true')
  const undistortionAnalyzed = verifiedTrue.filter(f => !f.distortion_label)

  async function extractFacts() {
    if (!presentation.transcript) { setError('This program has no transcript yet.'); return }
    if (facts.length > 0) {
      if (!confirm(`Replace the ${facts.length} existing fact${facts.length === 1 ? '' : 's'} with a fresh extraction?`)) return
    }
    setBusy('extract'); setError('')
    try {
      const res = await fetch(EXTRACT_FACTS_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'apikey':        SUPABASE_ANON_KEY
        },
        body: JSON.stringify({ transcript: presentation.transcript })
      })
      if (!res.ok) throw new Error(`Extract failed (${res.status}): ${await res.text()}`)
      const { facts: extracted } = await res.json()
      if (!Array.isArray(extracted) || extracted.length === 0) {
        throw new Error('No facts were extracted. The transcript may not contain checkable claims.')
      }
      if (facts.length > 0) {
        const { error: delErr } = await supabase.from('extracted_facts').delete().eq('presentation_id', presentation.id)
        if (delErr) throw delErr
      }
      const rows = extracted.map((f, i) => ({
        presentation_id: presentation.id,
        fact_text: f,
        ordinal: i
      }))
      const { error: insErr } = await supabase.from('extracted_facts').insert(rows)
      if (insErr) throw insErr
      await refresh()
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setBusy('')
    }
  }

  async function verifyUnlabeled() {
    if (unverified.length === 0) { setError('All facts are already labeled.'); return }
    setBusy('verify'); setError('')
    try {
      const BATCH = 20
      for (let i = 0; i < unverified.length; i += BATCH) {
        const batch = unverified.slice(i, i + BATCH)
        const res = await fetch(VERIFY_FACTS_URL, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'apikey':        SUPABASE_ANON_KEY
          },
          body: JSON.stringify({ facts: batch.map(f => f.fact_text) })
        })
        if (!res.ok) throw new Error(`Verify failed (${res.status}): ${await res.text()}`)
        const { results } = await res.json()
        const now = new Date().toISOString()
        await Promise.all(batch.map((f, j) => {
          const r = results[j]
          if (!r) return Promise.resolve()
          return supabase.from('extracted_facts').update({
            label: r.label, reasoning: r.reasoning, analyzed_at: now
          }).eq('id', f.id)
        }))
      }
      await refresh()
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setBusy('')
    }
  }

  async function analyzeDistortion() {
    if (undistortionAnalyzed.length === 0) { setError('No verified-true facts to analyze.'); return }
    if (!presentation.transcript) { setError('Transcript is required for distortion analysis.'); return }
    setBusy('distortion'); setError('')
    try {
      const BATCH = 15
      for (let i = 0; i < undistortionAnalyzed.length; i += BATCH) {
        const batch = undistortionAnalyzed.slice(i, i + BATCH)
        const res = await fetch(ANALYZE_DISTORTION_URL, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'apikey':        SUPABASE_ANON_KEY
          },
          body: JSON.stringify({
            transcript: presentation.transcript,
            facts: batch.map(f => f.fact_text)
          })
        })
        if (!res.ok) throw new Error(`Distortion analysis failed (${res.status}): ${await res.text()}`)
        const { results } = await res.json()
        const now = new Date().toISOString()
        await Promise.all(batch.map((f, j) => {
          const r = results[j]
          if (!r) return Promise.resolve()
          return supabase.from('extracted_facts').update({
            distortion_label: r.label,
            distortion_reasoning: r.reasoning,
            distortion_analyzed_at: now
          }).eq('id', f.id)
        }))
      }
      await refresh()
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setBusy('')
    }
  }

  async function updateFact(id, fields) {
    const { error } = await supabase.from('extracted_facts').update(fields).eq('id', id)
    if (error) alert(error.message)
  }

  async function deleteFact(id) {
    if (!confirm('Delete this fact?')) return
    const { error } = await supabase.from('extracted_facts').delete().eq('id', id)
    if (error) alert(error.message)
  }

  async function addManualFact() {
    const text = prompt('Add a fact in your own words:')
    if (!text || !text.trim()) return
    const maxOrdinal = Math.max(-1, ...facts.map(f => f.ordinal ?? 0))
    const { error } = await supabase.from('extracted_facts').insert({
      presentation_id: presentation.id,
      fact_text: text.trim(),
      ordinal: maxOrdinal + 1
    })
    if (error) alert(error.message)
  }

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
        {!presentation.transcript && (
          <div className="text-sm text-red-600 mt-2">No transcript on this program. Add one first.</div>
        )}
      </section>

      <section className="card">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div>
            <h2 className="font-display text-xl">Step 1 · Extract facts</h2>
            <div className="text-xs text-ink/60">Pulls atomic factual claims from the transcript.</div>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={addManualFact} disabled={busy !== ''}>Add manually</button>
            <button className="btn-primary" onClick={extractFacts} disabled={!presentation.transcript || busy !== ''}>
              {busy === 'extract' ? 'Extracting…' : facts.length > 0 ? 'Re-extract' : 'Extract facts'}
            </button>
          </div>
        </div>
        {error && <div className="text-sm text-red-600 mt-2">{error}</div>}
        {facts.length === 0 && !error && (
          <div className="text-sm text-ink/60 mt-2">No facts yet. Click <em>Extract facts</em> to begin.</div>
        )}
      </section>

      {facts.length > 0 && (
        <section className="card">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <div>
              <h2 className="font-display text-xl">Step 2 · Fact Check (layer 1)</h2>
              <div className="text-xs text-ink/60">Claude labels each fact and gives reasoning.</div>
            </div>
            <button className="btn-primary" onClick={verifyUnlabeled}
                    disabled={busy !== '' || unverified.length === 0}>
              {busy === 'verify' ? 'Verifying…' : unverified.length === 0 ? 'All labeled' : `Verify ${unverified.length} unlabeled`}
            </button>
          </div>

          <LabelDistribution facts={facts} info={LABEL_INFO} field="label" />
        </section>
      )}

      {verifiedTrue.length > 0 && (
        <section className="card">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <div>
              <h2 className="font-display text-xl">Step 3 · Distortion check (layer 2)</h2>
              <div className="text-xs text-ink/60">
                Looks at how each verified-true fact was actually presented in the transcript.
              </div>
            </div>
            <button className="btn-primary" onClick={analyzeDistortion}
                    disabled={busy !== '' || undistortionAnalyzed.length === 0 || !presentation.transcript}>
              {busy === 'distortion' ? 'Analyzing…' : undistortionAnalyzed.length === 0 ? 'All analyzed' : `Analyze ${undistortionAnalyzed.length}`}
            </button>
          </div>

          <LabelDistribution
            facts={verifiedTrue.filter(f => f.distortion_label)}
            info={DISTORTION_INFO}
            field="distortion_label"
          />
        </section>
      )}

      {facts.length > 0 && (
        <section className="card">
          <h2 className="font-display text-xl mb-3">All facts</h2>
          <ul className="divide-y divide-sunrise-100">
            {facts.map((f, idx) => (
              <FactRow
                key={f.id}
                fact={f}
                ordinal={idx + 1}
                onUpdate={(fields) => updateFact(f.id, fields)}
                onDelete={() => deleteFact(f.id)}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function LabelDistribution({ facts, info, field }) {
  const counts = Object.fromEntries(Object.keys(info).map(k => [k, 0]))
  for (const f of facts) {
    const v = f[field]
    if (v && counts.hasOwnProperty(v)) counts[v]++
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (total === 0) {
    return <div className="text-sm text-ink/60">Nothing analyzed yet.</div>
  }
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

function FactRow({ fact, ordinal, onUpdate, onDelete }) {
  const [editingText, setEditingText] = useState(false)
  const [draftText, setDraftText] = useState(fact.fact_text)
  const [editingReason, setEditingReason] = useState(false)
  const [draftReason, setDraftReason] = useState(fact.reasoning ?? '')
  const [editingDistReason, setEditingDistReason] = useState(false)
  const [draftDistReason, setDraftDistReason] = useState(fact.distortion_reasoning ?? '')

  const info = fact.label ? LABEL_INFO[fact.label] : null
  const distInfo = fact.distortion_label ? DISTORTION_INFO[fact.distortion_label] : null
  const showDistortion = fact.label === 'true'

  function saveText() {
    const next = draftText.trim()
    if (next && next !== fact.fact_text) onUpdate({ fact_text: next })
    setEditingText(false)
  }
  function saveReason() {
    const next = draftReason.trim()
    if (next !== (fact.reasoning ?? '')) onUpdate({ reasoning: next || null })
    setEditingReason(false)
  }
  function saveDistReason() {
    const next = draftDistReason.trim()
    if (next !== (fact.distortion_reasoning ?? '')) onUpdate({ distortion_reasoning: next || null })
    setEditingDistReason(false)
  }

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <span className="text-xs text-ink/40 font-mono pt-0.5 w-6 text-right shrink-0">{ordinal}.</span>
        <div className="flex-1 min-w-0">
          {editingText ? (
            <textarea
              className="input text-sm"
              rows={2}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onBlur={saveText}
              autoFocus
            />
          ) : (
            <div
              className="text-sm cursor-text leading-relaxed"
              onClick={() => { setDraftText(fact.fact_text); setEditingText(true) }}
              title="Click to edit"
            >
              {fact.fact_text}
            </div>
          )}

          {/* Layer 1: fact-check */}
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {info ? (
              <span className={`pill ${info.cls}`}>{info.display}</span>
            ) : (
              <span className="pill bg-sunrise-50 text-sunrise-700 border border-sunrise-200">Unlabeled</span>
            )}
            <select
              className="text-xs bg-transparent border-0 text-ink/60 underline cursor-pointer"
              value={fact.label || ''}
              onChange={(e) => onUpdate({
                label: e.target.value || null,
                analyzed_at: e.target.value ? new Date().toISOString() : null
              })}
            >
              <option value="">— change verification —</option>
              <option value="">Clear label</option>
              {Object.entries(LABEL_INFO).map(([k, v]) => (
                <option key={k} value={k}>{v.display}</option>
              ))}
            </select>
          </div>

          {editingReason ? (
            <textarea
              className="input text-xs mt-2"
              rows={2}
              value={draftReason}
              onChange={(e) => setDraftReason(e.target.value)}
              onBlur={saveReason}
              autoFocus
              placeholder="Reasoning for the verification label"
            />
          ) : fact.reasoning ? (
            <div
              className="text-xs text-ink/70 mt-1.5 leading-relaxed cursor-text whitespace-pre-wrap"
              onClick={() => { setDraftReason(fact.reasoning ?? ''); setEditingReason(true) }}
              title="Click to edit"
            >
              {fact.reasoning}
            </div>
          ) : info ? (
            <button
              className="text-xs text-ink/40 underline mt-1.5"
              onClick={() => { setDraftReason(''); setEditingReason(true) }}
            >Add reasoning</button>
          ) : null}

          {/* Layer 2: distortion (only for verified-true facts) */}
          {showDistortion && (
            <div className="mt-3 pt-3 border-t border-sunrise-50">
              <div className="text-[10px] uppercase tracking-wider text-ink/40 mb-1">Distortion check</div>
              <div className="flex items-center gap-2 flex-wrap">
                {distInfo ? (
                  <span className={`pill ${distInfo.cls}`}>{distInfo.display}</span>
                ) : (
                  <span className="pill bg-sunrise-50 text-sunrise-700 border border-sunrise-200">Not yet analyzed</span>
                )}
                <select
                  className="text-xs bg-transparent border-0 text-ink/60 underline cursor-pointer"
                  value={fact.distortion_label || ''}
                  onChange={(e) => onUpdate({
                    distortion_label: e.target.value || null,
                    distortion_analyzed_at: e.target.value ? new Date().toISOString() : null
                  })}
                >
                  <option value="">— change distortion —</option>
                  <option value="">Clear label</option>
                  {Object.entries(DISTORTION_INFO).map(([k, v]) => (
                    <option key={k} value={k}>{v.display}</option>
                  ))}
                </select>
              </div>
              {editingDistReason ? (
                <textarea
                  className="input text-xs mt-2"
                  rows={2}
                  value={draftDistReason}
                  onChange={(e) => setDraftDistReason(e.target.value)}
                  onBlur={saveDistReason}
                  autoFocus
                  placeholder="Reasoning for the distortion label"
                />
              ) : fact.distortion_reasoning ? (
                <div
                  className="text-xs text-ink/70 mt-1.5 leading-relaxed cursor-text whitespace-pre-wrap"
                  onClick={() => { setDraftDistReason(fact.distortion_reasoning ?? ''); setEditingDistReason(true) }}
                  title="Click to edit"
                >
                  {fact.distortion_reasoning}
                </div>
              ) : distInfo ? (
                <button
                  className="text-xs text-ink/40 underline mt-1.5"
                  onClick={() => { setDraftDistReason(''); setEditingDistReason(true) }}
                >Add reasoning</button>
              ) : null}
            </div>
          )}

          {fact.analyzed_at && (
            <div className="text-[10px] text-ink/40 mt-2">
              Analyzed {new Date(fact.analyzed_at).toLocaleString()}
            </div>
          )}
        </div>
        <button className="btn-ghost text-xs" onClick={onDelete} title="Remove this fact">Remove</button>
      </div>
    </li>
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
          Both programs need facts to have been extracted in the single-program view. Distortion stats appear once the distortion check has been run.
        </div>
      </section>

      {leftId && rightId && (
        <div className="grid sm:grid-cols-2 gap-4">
          <ProgramStatsCard
            presentation={presentations.find(p => p.id === leftId)}
            speakers={speakers}
          />
          <ProgramStatsCard
            presentation={presentations.find(p => p.id === rightId)}
            speakers={speakers}
          />
        </div>
      )}
    </>
  )
}

function ProgramStatsCard({ presentation, speakers }) {
  const { rows: facts } = useTable('extracted_facts', {
    orderBy: 'ordinal',
    filter: { presentation_id: presentation?.id }
  })
  if (!presentation) return null
  const sp = speakers.find(s => s.id === presentation.speaker_id)
  const total = facts.length
  const verifiedTrue = facts.filter(f => f.label === 'true').length
  const undistorted = facts.filter(f => f.distortion_label === 'undistorted').length

  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wider text-ink/50">{formatShort(presentation.scheduled_date)}</div>
      <h3 className="font-display text-lg leading-tight mt-1">
        {presentation.topic_title || <span className="text-ink/40">Untitled</span>}
      </h3>
      <div className="text-sm text-ink/70">{sp?.name || 'Speaker not recorded'}</div>

      {total === 0 ? (
        <div className="mt-3 text-sm text-ink/60">No facts extracted yet for this program.</div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="Facts" value={total} />
            <Stat label="Verified" value={verifiedTrue} pct={total ? Math.round(verifiedTrue * 100 / total) : 0} />
            <Stat label="Clean" value={undistorted} pct={verifiedTrue ? Math.round(undistorted * 100 / verifiedTrue) : 0}
                  hint="undistorted, of verified true" />
          </div>

          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-wider text-ink/40 mb-1">Verification</div>
            <LabelDistribution facts={facts} info={LABEL_INFO} field="label" />
          </div>

          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-ink/40 mb-1">Distortion</div>
            <LabelDistribution facts={facts} info={DISTORTION_INFO} field="distortion_label" />
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, pct, hint }) {
  return (
    <div className="bg-sunrise-50 rounded-lg p-2">
      <div className="text-2xl font-display leading-none">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-ink/50 mt-1">{label}</div>
      {typeof pct === 'number' && <div className="text-[10px] text-ink/60">{pct}%</div>}
      {hint && <div className="text-[9px] text-ink/40 mt-0.5">{hint}</div>}
    </div>
  )
}
