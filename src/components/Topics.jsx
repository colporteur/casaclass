import { useState } from 'react'
import { useTable } from '../hooks/useTable.js'
import { supabase } from '../lib/supabase.js'
import { getDisplayName } from '../lib/identity.js'

export default function Topics() {
  const { rows: topics }   = useTable('topic_suggestions', { orderBy: 'created_at', ascending: false })
  const { rows: speakers } = useTable('speakers',          { orderBy: 'name' })

  const [title, setTitle]             = useState('')
  const [description, setDescription] = useState('')
  const [speakerId, setSpeakerId]     = useState('')
  const [filter, setFilter]           = useState('proposed')

  async function add(e) {
    e.preventDefault()
    if (!title.trim()) return
    const { error } = await supabase.from('topic_suggestions').insert({
      title: title.trim(),
      description: description.trim() || null,
      suggested_speaker_id: speakerId || null,
      suggested_by: getDisplayName() || null
    })
    if (error) alert(error.message)
    else { setTitle(''); setDescription(''); setSpeakerId('') }
  }

  async function patch(id, fields) {
    const { error } = await supabase.from('topic_suggestions').update(fields).eq('id', id)
    if (error) alert(error.message)
  }

  async function remove(id) {
    const { error } = await supabase.from('topic_suggestions').delete().eq('id', id)
    if (error) alert(error.message)
  }

  async function vote(t, delta) {
    await patch(t.id, { votes: (t.votes ?? 0) + delta })
  }

  const filtered = topics.filter(t => filter === 'all' || t.status === filter)

  return (
    <div className="space-y-6">
      <section className="card">
        <h1 className="font-display text-2xl mb-1">Topic ideas</h1>
        <p className="text-sm text-ink/60 mb-3">
          Anyone can propose a topic. Suggest a presenter if you have one in mind.
        </p>
        <form onSubmit={add} className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
          <input className="input" placeholder="Topic title" value={title} onChange={e => setTitle(e.target.value)} />
          <select className="input" value={speakerId} onChange={e => setSpeakerId(e.target.value)}>
            <option value="">Suggested speaker (optional)</option>
            {speakers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="btn-primary">Suggest</button>
          <textarea
            className="input sm:col-span-3"
            rows={2}
            placeholder="Short description or why it would be a great topic"
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </form>
      </section>

      <section className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-xl">Backlog</h2>
          <div className="flex gap-1">
            {['proposed', 'scheduled', 'archived', 'all'].map(k => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`px-3 py-1 rounded-full text-xs font-medium ${filter === k ? 'bg-sunrise-500 text-white' : 'bg-sunrise-50 text-sunrise-700 hover:bg-sunrise-100'}`}
              >{k}</button>
            ))}
          </div>
        </div>

        <ul className="divide-y divide-sunrise-100">
          {filtered.length === 0 && (
            <li className="py-6 text-center text-sm text-ink/50">Nothing here yet.</li>
          )}
          {filtered.map(t => {
            const sp = speakers.find(s => s.id === t.suggested_speaker_id)
            return (
              <li key={t.id} className="py-3 flex items-start gap-3">
                <div className="flex flex-col items-center gap-1">
                  <button className="btn-ghost text-sm py-0.5" onClick={() => vote(t, +1)} title="+1">▲</button>
                  <span className="text-sm font-semibold">{t.votes ?? 0}</span>
                  <button className="btn-ghost text-sm py-0.5" onClick={() => vote(t, -1)} title="-1">▼</button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{t.title}</div>
                  {t.description && <div className="text-xs text-ink/70 mt-0.5">{t.description}</div>}
                  <div className="text-[11px] text-ink/50 mt-1">
                    {t.suggested_by ? `from ${t.suggested_by}` : 'anonymous'}
                    {sp && <> · suggested speaker: <span className="font-medium">{sp.name}</span></>}
                    {' · '}{t.status}
                  </div>
                </div>
                <div className="flex gap-1">
                  <select
                    className="input text-xs py-1 max-w-[8rem]"
                    value={t.status}
                    onChange={e => patch(t.id, { status: e.target.value })}
                  >
                    <option value="proposed">proposed</option>
                    <option value="scheduled">scheduled</option>
                    <option value="archived">archived</option>
                  </select>
                  <button className="btn-ghost text-xs" onClick={() => remove(t.id)}>×</button>
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
