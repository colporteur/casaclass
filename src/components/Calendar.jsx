import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTable } from '../hooks/useTable.js'
import { supabase } from '../lib/supabase.js'
import { quarterRange, monthsForRange, todayISO } from '../lib/dates.js'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function Calendar() {
  const navigate = useNavigate()
  const { rows: presentations } = useTable('presentations', { orderBy: 'scheduled_date' })
  const { rows: speakers }      = useTable('speakers')

  const [refDate, setRefDate] = useState(new Date())
  const { start, end } = useMemo(() => quarterRange(refDate), [refDate])
  const months = useMemo(() => monthsForRange(start, end), [start, end])

  const byDate = useMemo(() => {
    const m = new Map()
    presentations.forEach(p => m.set(p.scheduled_date, p))
    return m
  }, [presentations])

  function shiftQuarter(delta) {
    const d = new Date(refDate)
    d.setMonth(d.getMonth() + 3 * delta)
    setRefDate(d)
  }

  async function openOrCreate(dateISO) {
    let row = byDate.get(dateISO)
    if (!row) {
      const { data, error } = await supabase
        .from('presentations')
        .insert({ scheduled_date: dateISO, status: 'scheduled' })
        .select()
        .single()
      if (error) { alert(error.message); return }
      row = data
    }
    navigate(`/presentation/${row.id}`)
  }

  const quarterLabel = `${start.toLocaleDateString(undefined, { month: 'long' })} – ${end.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`

  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Calendar</h1>
          <div className="text-sm text-ink/60">{quarterLabel}</div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={() => shiftQuarter(-1)}>← Prev quarter</button>
          <button className="btn-ghost"     onClick={() => setRefDate(new Date())}>Today</button>
          <button className="btn-secondary" onClick={() => shiftQuarter(1)}>Next quarter →</button>
        </div>
      </section>

      <div className="grid md:grid-cols-3 gap-4">
        {months.map(m => (
          <MonthCard
            key={m.toISOString()}
            month={m}
            byDate={byDate}
            speakers={speakers}
            onPick={openOrCreate}
          />
        ))}
      </div>

      <p className="text-xs text-ink/60 px-1">
        Tip: click any Wednesday to open or create that week's program. Past Wednesdays show their topic and presenter.
      </p>
    </div>
  )
}

function MonthCard({ month, byDate, speakers, onPick }) {
  const today = todayISO()
  const year = month.getFullYear()
  const m = month.getMonth()
  const first = new Date(year, m, 1)
  const last  = new Date(year, m + 1, 0)
  const startWeekday = first.getDay()

  const cells = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= last.getDate(); d++) {
    const dt = new Date(year, m, d)
    cells.push(dt)
  }
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="card">
      <h3 className="font-display text-lg mb-2">
        {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
      </h3>
      <div className="grid grid-cols-7 text-center text-[10px] uppercase tracking-wide text-ink/50 mb-1">
        {WEEKDAYS.map(d => <div key={d}>{d[0]}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c) return <div key={i} className="h-12" />
          const iso = c.toISOString().slice(0, 10)
          const isWed = c.getDay() === 3
          const pres = byDate.get(iso)
          const sp = pres ? speakers.find(s => s.id === pres.speaker_id) : null
          const past = iso < today
          const isToday = iso === today

          const base = 'h-12 rounded-lg text-[11px] flex flex-col items-center justify-center border transition'
          const tone = isWed
            ? pres
              ? past
                ? 'bg-sky-50 border-sky-200 text-ink hover:bg-sky-100 cursor-pointer'
                : 'bg-sunrise-100 border-sunrise-300 text-sunrise-700 hover:bg-sunrise-200 cursor-pointer'
              : 'bg-white border-sunrise-200 text-ink/70 hover:bg-sunrise-50 cursor-pointer'
            : 'bg-white border-transparent text-ink/40'

          return (
            <button
              key={i}
              disabled={!isWed}
              onClick={() => isWed && onPick(iso)}
              className={`${base} ${tone} ${isToday ? 'ring-2 ring-sunrise-400' : ''}`}
              title={pres ? (sp?.name ? `${sp.name} — ${pres.topic_title || 'TBD'}` : pres.topic_title || 'Scheduled') : (isWed ? 'Click to plan' : '')}
            >
              <span className="font-semibold leading-tight">{c.getDate()}</span>
              {pres && (
                <span className="truncate w-full px-1 text-center text-[9px] opacity-80">
                  {sp?.name?.split(' ')[0] || (pres.topic_title ? '★' : '·')}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
