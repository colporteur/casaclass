import { Link } from 'react-router-dom'
import { useTable } from '../hooks/useTable.js'
import { todayISO, formatLong, formatShort, upcomingWednesdays } from '../lib/dates.js'

export default function Dashboard() {
  const { rows: speakers }      = useTable('speakers',          { orderBy: 'rotation_order' })
  const { rows: presentations } = useTable('presentations',     { orderBy: 'scheduled_date' })
  const { rows: suggestions }   = useTable('topic_suggestions', { orderBy: 'created_at', ascending: false })

  const today = todayISO()
  const upcoming = presentations
    .filter(p => p.scheduled_date >= today && p.status !== 'completed' && p.status !== 'cancelled')
    .slice(0, 5)
  const next = upcoming[0]
  const nextSpeaker = next ? speakers.find(s => s.id === next.speaker_id) : null
  const nextCoNames = next
    ? (next.co_speaker_ids ?? [])
        .map(id => speakers.find(s => s.id === id)?.name)
        .filter(Boolean)
    : []

  // If there's no presentation row for the next Wednesday, hint at it.
  const nextWed = upcomingWednesdays(1)[0]
  const noPlanForNext = !next || next.scheduled_date !== nextWed

  return (
    <div className="space-y-6">
      <section className="card-tint relative overflow-hidden">
        <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-sunrise-200/60" />
        <div className="absolute -right-2 -top-2 w-24 h-24 rounded-full bg-sunrise-300/70" />
        <div className="relative">
          <div className="text-xs uppercase tracking-wider text-sunrise-700/80 font-semibold">
            Next up
          </div>
          {next ? (
            <>
              <h1 className="font-display text-3xl sm:text-4xl mt-1 leading-tight">
                {next.topic_title || <span className="text-ink/40">Topic to be announced</span>}
              </h1>
              <div className="mt-2 text-ink/70">
                <span className="font-medium">{nextSpeaker?.name || 'Speaker TBD'}</span>
                {nextCoNames.length > 0 && (
                  <span className="text-ink/60"> with {nextCoNames.join(', ')}</span>
                )}
                {' · '}
                {formatLong(next.scheduled_date)}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to={`/presentation/${next.id}`} className="btn-primary">Open program</Link>
                <Link to="/calendar" className="btn-secondary">See calendar</Link>
              </div>
            </>
          ) : (
            <>
              <h1 className="font-display text-3xl sm:text-4xl mt-1 leading-tight">
                No program scheduled yet
              </h1>
              <div className="mt-2 text-ink/70">
                Add speakers, then schedule the next few Wednesdays from the Speakers page.
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/speakers" className="btn-primary">Set up speakers</Link>
              </div>
            </>
          )}
        </div>
      </section>

      <div className="grid sm:grid-cols-2 gap-6">
        <section className="card">
          <h2 className="font-display text-xl mb-3">Coming up</h2>
          {upcoming.length === 0 && (
            <p className="text-sm text-ink/60">Nothing scheduled. Head to the Calendar to plan.</p>
          )}
          {noPlanForNext && upcoming.length > 0 && (
            <div className="text-xs text-coral-500 mb-2">
              Heads up: nothing scheduled for {formatShort(nextWed)} yet.
            </div>
          )}
          <ul className="divide-y divide-sunrise-100">
            {upcoming.map(p => {
              const sp = speakers.find(s => s.id === p.speaker_id)
              const extras = (p.co_speaker_ids ?? []).filter(id => speakers.some(s => s.id === id)).length
              return (
                <li key={p.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {p.topic_title || <span className="text-ink/40">Topic TBD</span>}
                    </div>
                    <div className="text-xs text-ink/60">
                      {formatLong(p.scheduled_date)} · {sp?.name || 'Speaker TBD'}
                      {extras > 0 && ` + ${extras} more`}
                    </div>
                  </div>
                  <Link to={`/presentation/${p.id}`} className="btn-ghost text-sm">Open</Link>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="card">
          <h2 className="font-display text-xl mb-3">Fresh topic ideas</h2>
          {suggestions.length === 0 && (
            <p className="text-sm text-ink/60">
              No suggestions yet. <Link to="/topics" className="text-sunrise-700 underline">Add one</Link>.
            </p>
          )}
          <ul className="divide-y divide-sunrise-100">
            {suggestions.slice(0, 5).map(s => (
              <li key={s.id} className="py-2">
                <div className="text-sm font-medium">{s.title}</div>
                <div className="text-xs text-ink/60">
                  {s.suggested_by ? `from ${s.suggested_by}` : 'anonymous'}
                </div>
              </li>
            ))}
          </ul>
          {suggestions.length > 0 && (
            <Link to="/topics" className="btn-ghost text-sm mt-2 inline-flex">See all topics →</Link>
          )}
        </section>
      </div>
    </div>
  )
}
