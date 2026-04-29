import { useEffect, useState } from 'react'
import { getDisplayName, setDisplayName } from '../lib/identity.js'

export default function NameBadge() {
  const [name, setName]   = useState(getDisplayName())
  const [editing, setEd]  = useState(false)
  const [draft, setDraft] = useState(name)

  useEffect(() => { setDraft(name) }, [name])

  function save() {
    const trimmed = draft.trim()
    setDisplayName(trimmed)
    setName(trimmed)
    setEd(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          className="input max-w-[12rem]"
          placeholder="Your first name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save() }}
        />
        <button className="btn-primary" onClick={save}>Save</button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setEd(true)}
      className="flex items-center gap-2 text-sm text-ink/70 hover:text-sunrise-700 transition"
      title="Click to change the name shown on your contributions."
    >
      <span className="w-8 h-8 rounded-full bg-sunrise-200 text-sunrise-700 grid place-items-center font-semibold">
        {(name || '?').slice(0, 1).toUpperCase()}
      </span>
      <span className="hidden sm:inline">
        {name ? <>Hi, <span className="font-medium">{name}</span></> : 'Add your name'}
      </span>
    </button>
  )
}
