// Tiny date helpers - kept dependency-free.

const ISO = (d) => d.toISOString().slice(0, 10)

export function todayISO() {
  return ISO(new Date())
}

// Returns this week's Wednesday if today is Wednesday-or-earlier, otherwise next week's.
export function nextWednesday(from = new Date()) {
  const d = new Date(from)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay() // 0 Sun .. 6 Sat
  const delta = (3 - day + 7) % 7
  d.setDate(d.getDate() + delta)
  return d
}

export function upcomingWednesdays(count = 13, from = new Date()) {
  const out = []
  let d = nextWednesday(from)
  for (let i = 0; i < count; i++) {
    out.push(ISO(d))
    d = new Date(d)
    d.setDate(d.getDate() + 7)
  }
  return out
}

export function formatLong(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

export function formatShort(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function quarterRange(ref = new Date()) {
  const m = ref.getMonth()
  const qStartMonth = Math.floor(m / 3) * 3
  const start = new Date(ref.getFullYear(), qStartMonth, 1)
  const end = new Date(ref.getFullYear(), qStartMonth + 3, 0)
  return { start, end }
}

export function monthsForRange(start, end) {
  const months = []
  const d = new Date(start.getFullYear(), start.getMonth(), 1)
  while (d <= end) {
    months.push(new Date(d))
    d.setMonth(d.getMonth() + 1)
  }
  return months
}
