import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTable } from '../hooks/useTable.js'
import { todayISO, formatLong } from '../lib/dates.js'

export default function History() {
  const { rows: presentations } = useTable('presentations', { orderBy: 'scheduled_date', ascending: false })
  const { rows: speakers }      = useTable('speakers')
  const [query, setQuery] = useState('')

  const today = todayISO()
  const past = useMemo(
    // Show everything dated before today, OR anything explicitly marked completed
    // (so today's session moves to History as soon as the transcript is saved).
    () => presentations.filter(p => p.scheduled_date < today || p.status === 'completed'),
    [presentations, today]
  )

  const q = query.trim().toLowerCase()
  const filtered = q
    ? past.filter(p => {
        const sp = speakers.find(s => s.id === p.speaker_id)
        const coNames = (p.co_speaker_ids ?? [])
          .map(id => speakers.find(s => s.id === id)?.name)
          .filter(Boolean)
        return [p.topic_title, p.topic_description, p.summary, sp?.name, ...coNames]
          .filter(Boolean)
          .some(s => s.toLowerCase().includes(q))
      })
    : past

  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">History</h1>
          <div className="text-sm text-ink/60">{past.length} previous program{past.length === 1 ? '' : 's'}</div>
        </div>
        <input
          className="input max-w-xs"
          placeholder="Search topic, speaker, or summary…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </section>

      <ul className="space-y-3">
        {filtered.length === 0 && (
          <li className="card text-sm text-ink/60 text-center">
            {past.length === 0 ? 'No past programs yet.' : 'No matches.'}
          </li>
        )}
        {filtered.map(p => {
          const sp = speakers.find(s => s.id === p.speaker_id)
          const coNames = (p.co_speaker_ids ?? [])
            .map(id => speakers.find(s => s.id === id)?.name)
            .filter(Boolean)
          return (
            <li key={p.id} className="card hover:shadow-lg transition">
              <Link to={`/presentation/${p.id}`} className="block">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-ink/50">{formatLong(p.scheduled_date)}</div>
                    <h3 className="font-display text-xl mt-0.5">
                      {p.topic_title || <span className="text-ink/40">Untitled</span>}
                    </h3>
                    <div className="text-sm text-ink/70">
                      {sp?.name || 'Speaker not recorded'}
                      {coNames.length > 0 && <span className="text-ink/60"> with {coNames.join(', ')}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.summary && <span className="pill-sun">summary</span>}
                    {p.transcript && <span className="pill-sky">transcript</span>}
                  </div>
                </div>
                {p.summary && (
                  <p className="text-sm text-ink/80 mt-2 line-clamp-3 whitespace-pre-wrap">
                    {p.summary.slice(0, 320)}{p.summary.length > 320 ? '…' : ''}
                  </p>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
