import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase, SUMMARIZE_FUNCTION_URL, SUPABASE_ANON_KEY } from '../lib/supabase.js'
import { useTable } from '../hooks/useTable.js'
import { getDisplayName } from '../lib/identity.js'
import { formatLong } from '../lib/dates.js'

export default function PresentationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [pres, setPres] = useState(null)
  const [loading, setLoading] = useState(true)

  const { rows: speakers }  = useTable('speakers', { orderBy: 'name' })
  const { rows: resources } = useTable('resources', { orderBy: 'created_at', filter: { presentation_id: id } })
  const { rows: questions } = useTable('questions', { orderBy: 'created_at', filter: { presentation_id: id } })

  useEffect(() => { loadOne() }, [id]) // eslint-disable-line

  async function loadOne() {
    setLoading(true)
    const { data, error } = await supabase.from('presentations').select('*').eq('id', id).single()
    if (error) console.error(error)
    setPres(data)
    setLoading(false)
  }

  // Realtime: keep the local presentation in sync.
  useEffect(() => {
    const ch = supabase
      .channel(`pres:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'presentations', filter: `id=eq.${id}` },
        () => loadOne())
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [id])

  async function patch(fields) {
    const { error } = await supabase.from('presentations').update(fields).eq('id', id)
    if (error) alert(error.message)
  }

  async function deletePresentation() {
    if (!confirm('Delete this program? Resources and questions will also be removed.')) return
    const { error } = await supabase.from('presentations').delete().eq('id', id)
    if (error) { alert(error.message); return }
    navigate('/calendar')
  }

  if (loading) return <div className="card">Loading…</div>
  if (!pres)   return <div className="card">Program not found. <Link to="/calendar" className="underline">Back to calendar</Link></div>

  const speaker = speakers.find(s => s.id === pres.speaker_id)

  return (
    <div className="space-y-6">
      <section className="card-tint">
        <div className="text-xs uppercase tracking-wider text-sunrise-700/80 font-semibold">
          {formatLong(pres.scheduled_date)}
        </div>
        <input
          className="font-display text-3xl bg-transparent w-full mt-1 focus:outline-none border-b border-transparent focus:border-sunrise-300"
          placeholder="Topic title…"
          defaultValue={pres.topic_title ?? ''}
          onBlur={(e) => e.target.value !== (pres.topic_title ?? '') && patch({ topic_title: e.target.value || null })}
        />
        <textarea
          className="input mt-3 bg-white/70"
          rows={2}
          placeholder="Short description (optional)"
          defaultValue={pres.topic_description ?? ''}
          onBlur={(e) => e.target.value !== (pres.topic_description ?? '') && patch({ topic_description: e.target.value || null })}
        />

        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <div>
            <label className="label">Presenter</label>
            <select
              className="input"
              value={pres.speaker_id ?? ''}
              onChange={(e) => patch({ speaker_id: e.target.value || null })}
            >
              <option value="">— Not assigned —</option>
              {speakers.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.is_regular ? '' : ' (guest)'}
                </option>
              ))}
            </select>
            {!speaker && (
              <div className="text-xs text-ink/60 mt-1">
                Add new speakers on the <Link to="/speakers" className="underline">Speakers page</Link>.
              </div>
            )}
          </div>
          <div>
            <label className="label">Status</label>
            <select
              className="input"
              value={pres.status}
              onChange={(e) => patch({ status: e.target.value })}
            >
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
      </section>

      <TranscriptCard pres={pres} onChange={patch} />
      <SummaryCard pres={pres} onSaved={loadOne} />

      <ResourcesCard presentationId={id} resources={resources} />
      <QuestionsCard presentationId={id} questions={questions} />

      <div className="text-right">
        <button className="btn-danger" onClick={deletePresentation}>Delete this program</button>
      </div>
    </div>
  )
}

function TranscriptCard({ pres, onChange }) {
  const [text, setText] = useState(pres.transcript ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { setText(pres.transcript ?? '') }, [pres.transcript])

  async function save() {
    setSaving(true); setSaved(false)
    await onChange({ transcript: text || null })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const t = await file.text()
    setText(t)
  }

  return (
    <section className="card">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="font-display text-xl">Transcript</h2>
        <div className="flex items-center gap-2">
          <label className="btn-secondary cursor-pointer">
            Upload .txt
            <input type="file" accept=".txt,.md,text/plain" className="hidden" onChange={uploadFile} />
          </label>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </div>
      <textarea
        className="input font-mono text-sm"
        rows={10}
        placeholder="Paste the transcript here, or upload a .txt file above."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="text-xs text-ink/50 mt-1">{(text?.length ?? 0).toLocaleString()} characters</div>
    </section>
  )
}

function SummaryCard({ pres, onSaved }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function summarize() {
    setBusy(true); setError('')
    try {
      if (!SUMMARIZE_FUNCTION_URL) throw new Error('Summarize function URL is not configured.')
      if (!pres.transcript || pres.transcript.length < 50) {
        throw new Error('Add a transcript first.')
      }
      const res = await fetch(SUMMARIZE_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Supabase Edge Functions require this header.
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY
        },
        body: JSON.stringify({
          presentation_id: pres.id,
          transcript: pres.transcript,
          topic_title: pres.topic_title || null
        })
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`Summarizer failed (${res.status}): ${t}`)
      }
      const json = await res.json()
      const summary = json.summary
      const { error } = await supabase
        .from('presentations')
        .update({ summary, summary_generated_at: new Date().toISOString() })
        .eq('id', pres.id)
      if (error) throw error
      await onSaved()
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <h2 className="font-display text-xl">AI summary</h2>
          {pres.summary_generated_at && (
            <div className="text-xs text-ink/50">
              Generated {new Date(pres.summary_generated_at).toLocaleString()}
            </div>
          )}
        </div>
        <button className="btn-primary" onClick={summarize} disabled={busy}>
          {busy ? 'Summarizing…' : pres.summary ? 'Re-generate' : 'Generate summary'}
        </button>
      </div>

      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}

      {pres.summary ? (
        <div className="prose prose-sm max-w-none whitespace-pre-wrap text-ink/90">
          {pres.summary}
        </div>
      ) : (
        <p className="text-sm text-ink/60">
          Once a transcript is saved, click <em>Generate summary</em> and Claude Sonnet 4.6 will produce a concise overview.
        </p>
      )}
    </section>
  )
}

function ResourcesCard({ presentationId, resources }) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState('link')
  const [notes, setNotes] = useState('')

  async function add(e) {
    e.preventDefault()
    if (!title.trim()) return
    const { error } = await supabase.from('resources').insert({
      presentation_id: presentationId,
      title: title.trim(),
      url: url.trim() || null,
      kind,
      notes: notes.trim() || null,
      added_by: getDisplayName() || null
    })
    if (error) alert(error.message)
    else { setTitle(''); setUrl(''); setNotes(''); setKind('link') }
  }

  async function remove(id) {
    const { error } = await supabase.from('resources').delete().eq('id', id)
    if (error) alert(error.message)
  }

  return (
    <section className="card">
      <h2 className="font-display text-xl mb-2">Recommended resources</h2>
      <form onSubmit={add} className="grid sm:grid-cols-[1fr_1fr_auto_auto] gap-2 mb-3">
        <input className="input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
        <input className="input" placeholder="URL (optional)" value={url} onChange={e => setUrl(e.target.value)} />
        <select className="input" value={kind} onChange={e => setKind(e.target.value)}>
          <option value="book">Book</option>
          <option value="link">Link</option>
          <option value="other">Other</option>
        </select>
        <button className="btn-primary">Add</button>
        <input className="input sm:col-span-4" placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
      </form>

      <ul className="divide-y divide-sunrise-100">
        {resources.length === 0 && (
          <li className="py-4 text-sm text-ink/50">No resources yet.</li>
        )}
        {resources.map(r => (
          <li key={r.id} className="py-2 flex items-start gap-3">
            <span className={r.kind === 'book' ? 'pill-coral' : r.kind === 'other' ? 'pill-sky' : 'pill-sun'}>
              {r.kind}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline text-sunrise-700">
                    {r.title}
                  </a>
                ) : r.title}
              </div>
              {r.notes && <div className="text-xs text-ink/70 mt-0.5">{r.notes}</div>}
              <div className="text-[11px] text-ink/40 mt-0.5">{r.added_by ? `added by ${r.added_by}` : 'added'}</div>
            </div>
            <button className="btn-ghost text-xs" onClick={() => remove(r.id)}>Remove</button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function QuestionsCard({ presentationId, questions }) {
  const [q, setQ] = useState('')

  async function add(e) {
    e.preventDefault()
    if (!q.trim()) return
    const { error } = await supabase.from('questions').insert({
      presentation_id: presentationId,
      question: q.trim(),
      asked_by: getDisplayName() || null
    })
    if (error) alert(error.message)
    else setQ('')
  }

  async function remove(id) {
    const { error } = await supabase.from('questions').delete().eq('id', id)
    if (error) alert(error.message)
  }

  return (
    <section className="card">
      <h2 className="font-display text-xl mb-2">Discussion questions</h2>
      <form onSubmit={add} className="flex gap-2 mb-3">
        <input className="input" placeholder="What's on your mind?" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn-primary">Log question</button>
      </form>
      <ul className="divide-y divide-sunrise-100">
        {questions.length === 0 && (
          <li className="py-4 text-sm text-ink/50">No questions yet — they'll appear here as people add them.</li>
        )}
        {questions.map(q => (
          <li key={q.id} className="py-2 flex items-start gap-3">
            <div className="flex-1">
              <div className="text-sm">{q.question}</div>
              <div className="text-[11px] text-ink/50 mt-0.5">
                {q.asked_by ? `from ${q.asked_by}` : 'anonymous'} · {new Date(q.created_at).toLocaleString()}
              </div>
            </div>
            <button className="btn-ghost text-xs" onClick={() => remove(q.id)}>Remove</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
