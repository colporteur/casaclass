import { useState } from 'react'
import { useTable } from '../hooks/useTable.js'
import {
  supabase,
  EXTRACT_FACTS_URL,
  VERIFY_FACTS_URL,
  SUPABASE_ANON_KEY
} from '../lib/supabase.js'
import { formatLong } from '../lib/dates.js'

// Six fact-checker labels. Future layers (logical fallacies, evidence quality,
// etc.) can layer on top — this list is intentionally the source of truth.
const LABEL_INFO = {
  true:         { display: 'True / Verified',           cls: 'bg-emerald-100 text-emerald-700' },
  false:        { display: 'False / Not Factual',       cls: 'bg-red-100 text-red-700' },
  partly_true:  { display: 'Partly True / Mixed',       cls: 'bg-amber-100 text-amber-700' },
  unverifiable: { display: 'Unverifiable / Unproven',   cls: 'bg-slate-100 text-slate-700' },
  disputed:     { display: 'Disputed',                  cls: 'bg-purple-100 text-purple-700' },
  outdated:     { display: 'Outdated',                  cls: 'bg-orange-100 text-orange-700' }
}

export default function ArgumentAnalyzer() {
  const { rows: presentations } = useTable('presentations', { orderBy: 'scheduled_date', ascending: false })
  const { rows: speakers }      = useTable('speakers')
  const [selectedId, setSelectedId] = useState('')

  const selectable = presentations.filter(p => p.transcript && p.transcript.trim().length >= 50)
  const selected   = presentations.find(p => p.id === selectedId)

  return (
    <div className="space-y-6">
      <section className="card">
        <h1 className="font-display text-2xl mb-1">Argument Analyzer</h1>
        <p className="text-sm text-ink/60 mb-3">
          Phase 1: <span className="font-medium text-ink/80">Fact Checker</span>. Pick a program that has a transcript,
          let Claude extract its factual claims, then verify each one. More phases will follow.
        </p>
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

      {selected && (
        <AnalyzerWorkspace
          key={selected.id}
          presentation={selected}
          speakers={speakers}
        />
      )}
    </div>
  )
}

function AnalyzerWorkspace({ presentation, speakers }) {
  const { rows: facts, refresh } = useTable('extracted_facts', {
    orderBy: 'ordinal',
    filter: { presentation_id: presentation.id }
  })

  const [busy, setBusy]   = useState('')   // '' | 'extract' | 'verify'
  const [error, setError] = useState('')

  const sp = speakers.find(s => s.id === presentation.speaker_id)
  const unverified = facts.filter(f => !f.label)

  async function extractFacts() {
    if (!presentation.transcript) {
      setError('This program has no transcript yet.')
      return
    }
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
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`Extract failed (${res.status}): ${t}`)
      }
      const { facts: extracted } = await res.json()
      if (!Array.isArray(extracted) || extracted.length === 0) {
        throw new Error('No facts were extracted. The transcript may not contain checkable claims.')
      }

      // Clear out old facts for this presentation
      if (facts.length > 0) {
        const { error: delErr } = await supabase
          .from('extracted_facts')
          .delete()
          .eq('presentation_id', presentation.id)
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
    if (unverified.length === 0) {
      setError('All facts are already labeled.')
      return
    }
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
        if (!res.ok) {
          const t = await res.text()
          throw new Error(`Verify failed (${res.status}): ${t}`)
        }
        const { results } = await res.json()
        const now = new Date().toISOString()
        await Promise.all(batch.map((f, j) => {
          const r = results[j]
          if (!r) return Promise.resolve()
          return supabase
            .from('extracted_facts')
            .update({ label: r.label, reasoning: r.reasoning, analyzed_at: now })
            .eq('id', f.id)
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

  // Distribution counts for the summary row
  const counts = Object.fromEntries(Object.keys(LABEL_INFO).map(k => [k, 0]))
  for (const f of facts) if (f.label && counts.hasOwnProperty(f.label)) counts[f.label]++

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
            <div className="text-xs text-ink/60">
              Pulls atomic factual claims from the transcript.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={addManualFact} disabled={busy !== ''}>Add manually</button>
            <button
              className="btn-primary"
              onClick={extractFacts}
              disabled={!presentation.transcript || busy !== ''}
            >
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
              <div className="text-xs text-ink/60">
                Claude labels each fact with one of six rubric labels and gives reasoning.
              </div>
            </div>
            <button
              className="btn-primary"
              onClick={verifyUnlabeled}
              disabled={busy !== '' || unverified.length === 0}
            >
              {busy === 'verify'
                ? 'Verifying…'
                : unverified.length === 0
                  ? 'All labeled'
                  : `Verify ${unverified.length} unlabeled`}
            </button>
          </div>

          {/* Distribution summary */}
          <div className="flex flex-wrap gap-2 mb-3">
            {Object.entries(LABEL_INFO).map(([k, info]) => (
              <span key={k} className={`pill ${info.cls}`}>
                {info.display}: {counts[k]}
              </span>
            ))}
            {unverified.length > 0 && (
              <span className="pill bg-sunrise-50 text-sunrise-700 border border-sunrise-200">
                Unlabeled: {unverified.length}
              </span>
            )}
          </div>

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

function FactRow({ fact, ordinal, onUpdate, onDelete }) {
  const [editingText, setEditingText] = useState(false)
  const [draftText, setDraftText] = useState(fact.fact_text)
  const [editingReason, setEditingReason] = useState(false)
  const [draftReason, setDraftReason] = useState(fact.reasoning ?? '')

  const info = fact.label ? LABEL_INFO[fact.label] : null

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

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <span className="text-xs text-ink/40 font-mono pt-0.5 w-6 text-right shrink-0">
          {ordinal}.
        </span>
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
              title="Click to edit the fact"
            >
              {fact.fact_text}
            </div>
          )}

          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {info ? (
              <span className={`pill ${info.cls}`}>{info.display}</span>
            ) : (
              <span className="pill bg-sunrise-50 text-sunrise-700 border border-sunrise-200">Unlabeled</span>
            )}
            <select
              className="text-xs bg-transparent border-0 text-ink/60 underline cursor-pointer"
              value={fact.label || ''}
              onChange={(e) => onUpdate({ label: e.target.value || null, analyzed_at: e.target.value ? new Date().toISOString() : null })}
            >
              <option value="">— change label —</option>
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
              placeholder="Your own reasoning or notes"
            />
          ) : fact.reasoning ? (
            <div
              className="text-xs text-ink/70 mt-1.5 leading-relaxed cursor-text whitespace-pre-wrap"
              onClick={() => { setDraftReason(fact.reasoning ?? ''); setEditingReason(true) }}
              title="Click to edit the reasoning"
            >
              {fact.reasoning}
            </div>
          ) : (
            <button
              className="text-xs text-ink/40 underline mt-1.5"
              onClick={() => { setDraftReason(''); setEditingReason(true) }}
            >
              Add reasoning
            </button>
          )}

          {fact.analyzed_at && (
            <div className="text-[10px] text-ink/40 mt-1">
              Analyzed {new Date(fact.analyzed_at).toLocaleString()}
            </div>
          )}
        </div>
        <button className="btn-ghost text-xs" onClick={onDelete} title="Remove this fact">Remove</button>
      </div>
    </li>
  )
}
