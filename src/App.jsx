import { Routes, Route, NavLink, Link } from 'react-router-dom'
import Dashboard from './components/Dashboard.jsx'
import Speakers from './components/Speakers.jsx'
import Calendar from './components/Calendar.jsx'
import PresentationDetail from './components/PresentationDetail.jsx'
import Topics from './components/Topics.jsx'
import History from './components/History.jsx'
import NameBadge from './components/NameBadge.jsx'

function NavItem({ to, label }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `px-3 py-1.5 rounded-full text-sm font-medium transition ${
          isActive
            ? 'bg-white text-sunrise-700 shadow-warm'
            : 'text-ink/70 hover:text-sunrise-700 hover:bg-white/60'
        }`
      }
    >
      {label}
    </NavLink>
  )
}

export default function App() {
  return (
    <div className="morning-bg relative min-h-full">
      <header className="relative z-10">
        <div className="max-w-5xl mx-auto px-4 pt-6 pb-3 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3">
            <SunriseLogo />
            <div>
              <div className="font-display text-2xl font-semibold leading-none">Casa Class</div>
              <div className="text-xs text-ink/60 mt-1">Wednesday-morning discussion group</div>
            </div>
          </Link>
          <NameBadge />
        </div>
        <nav className="max-w-5xl mx-auto px-4 pb-4">
          <div className="inline-flex flex-wrap gap-1 bg-white/70 backdrop-blur rounded-full p-1 border border-sunrise-100 shadow-warm">
            <NavItem to="/"          label="Dashboard" />
            <NavItem to="/calendar"  label="Calendar" />
            <NavItem to="/speakers"  label="Speakers" />
            <NavItem to="/topics"    label="Topics" />
            <NavItem to="/history"   label="History" />
          </div>
        </nav>
      </header>

      <main className="relative z-10 max-w-5xl mx-auto px-4 pb-16">
        <Routes>
          <Route path="/"                       element={<Dashboard />} />
          <Route path="/calendar"               element={<Calendar />} />
          <Route path="/speakers"               element={<Speakers />} />
          <Route path="/topics"                 element={<Topics />} />
          <Route path="/history"                element={<History />} />
          <Route path="/presentation/:id"       element={<PresentationDetail />} />
          <Route path="*"                       element={<Dashboard />} />
        </Routes>
      </main>

      <footer className="relative z-10 max-w-5xl mx-auto px-4 pb-8 text-xs text-ink/50">
        Casa Class · made for Wednesday mornings
      </footer>
    </div>
  )
}

function SunriseLogo() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"   stopColor="#FDE68A"/>
          <stop offset="100%" stopColor="#BAE6FD"/>
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="20" fill="url(#sky)"/>
      <circle cx="20" cy="26" r="8" fill="#F59E0B"/>
      <rect x="0" y="28" width="40" height="12" fill="#FFFBF0"/>
      <g stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round">
        <line x1="20" y1="6" x2="20" y2="11" />
        <line x1="6"  y1="20" x2="11" y2="20" />
        <line x1="29" y1="20" x2="34" y2="20" />
        <line x1="10" y1="10" x2="13" y2="13" />
        <line x1="30" y1="10" x2="27" y2="13" />
      </g>
    </svg>
  )
}
