import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTable } from '../hooks/useTable.js'
import { supabase } from '../lib/supabase.js'
import { todayISO, formatLong } from '../lib/dates.js'
import { generateBookletPdf } from '../lib/booklet.js'

export default function History() {
  const { rows: presentations } = useTable('presentations', { orderBy: 'scheduled_date', ascending: false })
  const { rows: speakers }      = useTable('speakers')
  const [query, setQuery] = useState('')
  const [bookletBusy, setBookletBusy] = useState(false)
  const [bookletError, setBookletError] = useState('')

  const today = todayISO()
  const past = useMemo(
    () => presentations.filter(p => p.scheduled_date < today || p.status === 'completed'),
    [presentations, today]
  )

  const summaryCount = past.filter(p => p.summary && p.summary.trim()).length

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

  async function downloadBooklet() {
    setBookletBusy(true); setBookletError('')
    try {
      // Fetch every resource in one go - we'll group them per presentation inside the generator.
      const { data: resources, error } = await supabase.from('resources').select('*')
      if (error) throw error

      const blob = await generateBookletPdf({
        presentations: past,
        speakers,
        resources: resources || []
      })

      const stamp = new Date().toISOString().slice(0, 10)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `casa-class-booklet-${stamp}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setBookletError(String(e.message || e))
    } finally {
      setBookletBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">History</h1>
          <div className="text-sm text-ink/60">{past.length} previous program{past.length === 1 ? '' : 's'}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            className="input max-w-xs"
            placeholder="Search topic, speaker, or summary…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <button
            className="btn-primary"
            onClick={downloadBooklet}
            disabled={bookletBusy || summaryCount === 0}
            title={summaryCount === 0 ? 'No AI summaries yet — generate one on a past program first.' : 'Download print-ready booklet PDF'}
          >
            {bookletBusy ? 'Building…' : 'Download booklet'}
          </button>
        </div>
      </section>

      {bookletError && (
        <div className="card text-sm text-red-600">Booklet error: {bookletError}</div>
      )}

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
