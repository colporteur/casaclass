import { useState } from 'react'
import { useTable } from '../hooks/useTable.js'
import { supabase } from '../lib/supabase.js'
import { upcomingWednesdays } from '../lib/dates.js'

export default function Speakers() {
  const { rows: speakers, refresh } = useTable('speakers', { orderBy: 'rotation_order' })
  const { rows: presentations }     = useTable('presentations', { orderBy: 'scheduled_date' })

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [scheduleNotice, setScheduleNotice] = useState('')

  async function addSpeaker(e) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    const maxOrder = Math.max(0, ...speakers.map(s => s.rotation_order ?? 0))
    const { error } = await supabase.from('speakers').insert({
      name: name.trim(),
      email: email.trim() || null,
      rotation_order: maxOrder + 1,
      is_regular: true
    })
    setBusy(false)
    if (error) alert(error.message)
    else { setName(''); setEmail(''); refresh() }
  }

  async function updateSpeaker(id, patch) {
    const { error } = await supabase.from('speakers').update(patch).eq('id', id)
    if (error) alert(error.message)
  }

  async function deleteSpeaker(id) {
    if (!confirm('Remove this speaker? Their past presentations will keep their name.')) return
    const { error } = await supabase.from('speakers').delete().eq('id', id)
    if (error) alert(error.message)
  }

  async function move(speaker, direction) {
    const sorted = [...speakers].sort((a, b) => (a.rotation_order ?? 0) - (b.rotation_order ?? 0))
    const idx = sorted.findIndex(s => s.id === speaker.id)
    const swap = sorted[idx + direction]
    if (!swap) return
    await Promise.all([
      updateSpeaker(speaker.id, { rotation_order: swap.rotation_order }),
      updateSpeaker(swap.id,    { rotation_order: speaker.rotation_order })
    ])
  }

  /**
   * Auto-schedule: for each of the next 8 Wednesdays that has no presentation row,
   * create one and assign the next speaker in rotation order. Skips guests
   * (is_regular = false). Wraps the rotation when it runs out.
   */
  async function autoSchedule() {
    const regulars = speakers
      .filter(s => s.is_regular)
      .sort((a, b) => (a.rotation_order ?? 0) - (b.rotation_order ?? 0))
    if (regulars.length === 0) {
      setScheduleNotice('Add some regular speakers first.')
      return
    }
    const wednesdays = upcomingWednesdays(8)
    const taken = new Set(presentations.map(p => p.scheduled_date))
    const open  = wednesdays.filter(d => !taken.has(d))
    if (open.length === 0) {
      setScheduleNotice('All upcoming Wednesdays are already scheduled.')
      return
    }

    // Continue rotation from whoever spoke most recently (if any).
    const past = presentations
      .filter(p => p.speaker_id && p.scheduled_date < wednesdays[0])
      .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date))
    let startIdx = 0
    if (past.length) {
      const lastIdx = regulars.findIndex(r => r.id === past[0].speaker_id)
      if (lastIdx >= 0) startIdx = (lastIdx + 1) % regulars.length
    }

    const inserts = open.map((date, i) => ({
      scheduled_date: date,
      speaker_id: regulars[(startIdx + i) % regulars.length].id,
      status: 'scheduled'
    }))
    const { error } = await supabase.from('presentations').insert(inserts)
    if (error) setScheduleNotice(error.message)
    else setScheduleNotice(`Scheduled ${inserts.length} upcoming Wednesday${inserts.length === 1 ? '' : 's'}.`)
  }

  const sorted = [...speakers].sort((a, b) => (a.rotation_order ?? 1e9) - (b.rotation_order ?? 1e9))

  return (
    <div className="space-y-6">
      <section className="card">
        <h1 className="font-display text-2xl mb-1">Speakers & rotation</h1>
        <p className="text-sm text-ink/60 mb-4">
          Add the regulars in the order you want them to lead. The auto-schedule button below
          fills the next eight Wednesdays using this rotation.
        </p>

        <form onSubmit={addSpeaker} className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 mb-4">
          <input className="input" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
          <input className="input" placeholder="Email (optional)" value={email} onChange={e => setEmail(e.target.value)} />
          <button className="btn-primary" disabled={busy}>Add speaker</button>
        </form>

        <ul className="divide-y divide-sunrise-100">
          {sorted.map((s, i) => (
            <li key={s.id} className="py-3 flex items-center gap-3">
              <span className="w-8 h-8 grid place-items-center rounded-full bg-sunrise-100 text-sunrise-700 font-semibold">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <input
                  className="input mb-1"
                  defaultValue={s.name}
                  onBlur={(e) => e.target.value !== s.name && updateSpeaker(s.id, { name: e.target.value })}
                />
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <input
                    className="input max-w-xs"
                    placeholder="Email"
                    defaultValue={s.email ?? ''}
                    onBlur={(e) => e.target.value !== (s.email ?? '') && updateSpeaker(s.id, { email: e.target.value || null })}
                  />
                  <label className="flex items-center gap-1 text-ink/70">
                    <input
                      type="checkbox"
                      checked={s.is_regular}
                      onChange={(e) => updateSpeaker(s.id, { is_regular: e.target.checked })}
                    />
                    Regular
                  </label>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button className="btn-ghost text-sm" onClick={() => move(s, -1)} title="Move up">↑</button>
                <button className="btn-ghost text-sm" onClick={() => move(s,  1)} title="Move down">↓</button>
                <button className="btn-danger text-sm" onClick={() => deleteSpeaker(s.id)}>Remove</button>
              </div>
            </li>
          ))}
          {sorted.length === 0 && (
            <li className="py-6 text-center text-ink/50 text-sm">No speakers yet — add the first one above.</li>
          )}
        </ul>
      </section>

      <section className="card">
        <h2 className="font-display text-xl mb-2">Auto-schedule the rotation</h2>
        <p className="text-sm text-ink/60 mb-3">
          Fills any unbooked Wednesdays in the next 8 weeks with regulars, in order.
          Picks up wherever the last presenter left off. Won't overwrite anything you've already set.
        </p>
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={autoSchedule}>Auto-schedule 8 weeks</button>
          {scheduleNotice && <span className="text-sm text-ink/70">{scheduleNotice}</span>}
        </div>
      </section>
    </div>
  )
}
