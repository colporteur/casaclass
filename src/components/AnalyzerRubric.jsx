import { Link } from 'react-router-dom'
import {
  LABEL_INFO, DISTORTION_INFO, FALLACY_INFO, EVIDENCE_INFO, SEVERITY_INFO, LAYER_NAMES
} from '../lib/labels.js'
import { DEFAULT_WEIGHTS, scoreToGrade } from '../lib/scoring.js'

// Hard-coded weight tables (mirror the scoring.js internals; documented here for transparency).
const VERIFY_WEIGHTS = {
  true: 1.0, partly_true: 0.5, disputed: 0.3, outdated: 0.2, false: 0.0
}
const DISTORTION_WEIGHTS = {
  undistorted: 1.0, missing_context: 0.7, understated: 0.5, exaggerated: 0.5,
  conflation: 0.4, misleading: 0.3, cherry_picked: 0.3
}
const EVIDENCE_WEIGHTS = {
  primary_source: 1.0, secondary_source: 0.8, vague_appeal: 0.4, anecdote: 0.3, no_support: 0.0
}
const SEVERITY_PENALTY = { minor: 1, moderate: 2, serious: 4 }

export default function AnalyzerRubric() {
  return (
    <div className="space-y-6">
      <section className="card">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <h1 className="font-display text-2xl">Argument Analyzer rubric</h1>
          <Link to="/analyzer" className="btn-secondary text-sm">← Back to Analyzer</Link>
        </div>
        <p className="text-sm text-ink/70 leading-relaxed">
          The Analyzer runs a discussion transcript through six layers of analysis. Each layer asks a different
          question, produces its own labels, and contributes to a composite score. Below is exactly what each
          layer looks for and how its labels weigh into the final number.
        </p>
      </section>

      {/* ----- Layer 1: Verification ----- */}
      <RubricSection
        n={1} name={LAYER_NAMES.verification}
        question="Is each factual claim actually true?"
        inputs={['Atomic factual claims extracted from the transcript']}
        approach="Claude evaluates each claim against mainstream evidence and assigns one of six labels. Layer 1 is the gating layer — distortion and evidence quality only run on facts that came out 'true' here."
      >
        <LabelTable
          info={LABEL_INFO}
          weights={VERIFY_WEIGHTS}
          unverifiableNote="Unverifiable facts are excluded from the denominator — they neither help nor hurt the score."
        />
        <ScoreFormula label="Score formula">
          <span>
            sum of weighted facts ÷ (total facts − unverifiable)
          </span>
        </ScoreFormula>
      </RubricSection>

      {/* ----- Layer 2: Distortion ----- */}
      <RubricSection
        n={2} name={LAYER_NAMES.distortion}
        question="Were the true facts presented faithfully, or twisted?"
        inputs={['Full transcript', 'Facts labeled true in Layer 1']}
        approach="For each verified-true fact, Claude judges HOW the speaker presented it. A true fact can still be exaggerated, downplayed, framed misleadingly, or stripped of context that listeners need. 'Undistorted' means the presentation was faithful."
      >
        <LabelTable info={DISTORTION_INFO} weights={DISTORTION_WEIGHTS} />
        <ScoreFormula label="Score formula">
          <span>average of weights across verified-true facts</span>
        </ScoreFormula>
      </RubricSection>

      {/* ----- Layer 3: Logical fallacies ----- */}
      <RubricSection
        n={3} name={LAYER_NAMES.fallacies}
        question="Did the speaker reason fallaciously anywhere?"
        inputs={['Full transcript']}
        approach="Claude scans the transcript for the twelve most common fallacy patterns. It flags only clear instances and reports the quoted passage, the fallacy type, and a severity. Zero fallacies is a perfectly normal result."
      >
        <h3 className="font-medium text-sm mt-3 mb-1.5">Fallacy categories</h3>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(FALLACY_INFO).map(([k, v]) => (
            <span key={k} className={`pill ${v.cls}`}>{v.display}</span>
          ))}
        </div>

        <h3 className="font-medium text-sm mt-4 mb-1.5">Severity tiers</h3>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(SEVERITY_INFO).map(([k, v]) => (
            <span key={k} className={`pill ${v.cls}`}>{v.display} · {SEVERITY_PENALTY[k]} pt</span>
          ))}
        </div>

        <ScoreFormula label="Score formula">
          <span>max(0, 1 − total severity points ÷ 10)</span>
        </ScoreFormula>
        <p className="text-xs text-ink/60 mt-2">
          So one serious fallacy alone = 0.60. Five minors = 0.50. Ten or more penalty points floors at 0.
        </p>
      </RubricSection>

      {/* ----- Layer 4: Evidence quality ----- */}
      <RubricSection
        n={4} name={LAYER_NAMES.evidence}
        question="What kind of support did the speaker offer for each verified fact?"
        inputs={['Full transcript', 'Facts labeled true in Layer 1']}
        approach="Even a true claim is epistemically weaker when stated without support. Claude judges what (if anything) the speaker offered as backing — a primary source, a named secondary source, a vague appeal, an anecdote, or nothing."
      >
        <LabelTable info={EVIDENCE_INFO} weights={EVIDENCE_WEIGHTS} />
        <ScoreFormula label="Score formula">
          <span>average of weights across verified-true facts</span>
        </ScoreFormula>
      </RubricSection>

      {/* ----- Layer 5: Internal consistency ----- */}
      <RubricSection
        n={5} name={LAYER_NAMES.consistency}
        question="Did the speaker contradict themselves anywhere?"
        inputs={['Full transcript', 'All extracted facts']}
        approach="Claude scans for places where the speaker asserts something that conflicts with something else they said in the same talk. Subtle position-shifts and evolving views are not flagged — only clear contradictions are."
      >
        <h3 className="font-medium text-sm mt-3 mb-1.5">Severity tiers</h3>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(SEVERITY_INFO).map(([k, v]) => (
            <span key={k} className={`pill ${v.cls}`}>{v.display} · {SEVERITY_PENALTY[k]} pt</span>
          ))}
        </div>
        <ScoreFormula label="Score formula">
          <span>max(0, 1 − total severity points ÷ 8)</span>
        </ScoreFormula>
        <p className="text-xs text-ink/60 mt-2">
          Slightly harsher than the fallacy penalty cap — internal contradictions are rarer and weigh heavier when they occur.
        </p>
      </RubricSection>

      {/* ----- Layer 6: Steelmanning ----- */}
      <RubricSection
        n={6} name={LAYER_NAMES.steelmanning}
        question="Did the speaker engage opposing views at their strongest, or only at their weakest?"
        inputs={['Full transcript']}
        approach="Claude judges whether the speaker presented opposing arguments fairly and at their strongest version (steelmanning) or only attacked weak straw-man versions. The judgment lands on a 0.0–1.0 scale directly."
      >
        <h3 className="font-medium text-sm mt-3 mb-1.5">Anchors on the 0–1 scale</h3>
        <ul className="text-sm space-y-1">
          <li><span className="font-mono">1.0</span> — Speaker presented the strongest opposing case before responding.</li>
          <li><span className="font-mono">0.7</span> — Opposing views were acknowledged fairly.</li>
          <li><span className="font-mono">0.5</span> — Opposing views noted but not really engaged (also the default when the talk doesn't argue for a position).</li>
          <li><span className="font-mono">0.3</span> — Only weak versions of opposing views appeared.</li>
          <li><span className="font-mono">0.0</span> — No opposing views appeared, or only caricatures were attacked.</li>
        </ul>
        <ScoreFormula label="Score formula">
          <span>Claude's score, clamped to 0–1</span>
        </ScoreFormula>
      </RubricSection>

      {/* ----- Composite scoring ----- */}
      <section className="card">
        <h2 className="font-display text-xl mb-2">Composite score</h2>
        <p className="text-sm text-ink/70 mb-3 leading-relaxed">
          The composite is a weighted average of whichever layers have been run. Layers that haven't run yet
          are skipped, and the remaining weights are renormalized to sum to 1 — so a partial analysis still
          produces a meaningful number, just one that's based on less of the picture.
        </p>

        <h3 className="font-medium text-sm mt-2 mb-1.5">Default weights</h3>
        <table className="text-sm w-full max-w-md">
          <tbody className="divide-y divide-sunrise-100">
            {Object.entries(DEFAULT_WEIGHTS).map(([k, w]) => (
              <tr key={k}>
                <td className="py-1.5 text-ink/80">{LAYER_NAMES[k]}</td>
                <td className="py-1.5 text-right font-mono">{Math.round(w * 100)}%</td>
              </tr>
            ))}
            <tr className="border-t border-sunrise-200">
              <td className="py-1.5 font-medium">Total</td>
              <td className="py-1.5 text-right font-mono font-medium">100%</td>
            </tr>
          </tbody>
        </table>

        <h3 className="font-medium text-sm mt-5 mb-1.5">Letter grade scale</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-sm">
          {[
            ['A',  '93%+'], ['A−', '85–92%'], ['B+', '80–84%'],
            ['B',  '73–79%'], ['B−', '67–72%'], ['C+', '60–66%'],
            ['C',  '53–59%'], ['C−', '47–52%'], ['D+', '40–46%'],
            ['D',  '33–39%'], ['F',  '< 33%']
          ].map(([g, r]) => (
            <div key={g} className="flex items-center gap-2">
              <span className="w-8 inline-flex justify-center font-display text-lg">{g}</span>
              <span className="text-ink/70 text-xs">{r}</span>
            </div>
          ))}
        </div>

        <h3 className="font-medium text-sm mt-5 mb-1.5">Renormalization in practice</h3>
        <p className="text-sm text-ink/70 leading-relaxed">
          Say you've only run Verification and Distortion — defaults give them 30% and 20% of the headline.
          Together that's 50%, so each is renormalized to 60% and 40% respectively, and the composite is the
          weighted average of just those two. The score still reflects what you've measured — it just doesn't
          pretend to know about layers you haven't run.
        </p>
      </section>

      <section className="card text-center">
        <Link to="/analyzer" className="btn-primary">Back to the Analyzer</Link>
      </section>
    </div>
  )
}

function RubricSection({ n, name, question, inputs, approach, children }) {
  return (
    <section className="card">
      <div className="flex items-baseline gap-3 mb-1">
        <span className="font-display text-3xl text-sunrise-700">{n}</span>
        <h2 className="font-display text-xl">{name}</h2>
      </div>
      <p className="text-sm italic text-ink/70 mb-3">{question}</p>

      <div className="grid sm:grid-cols-2 gap-4 text-sm">
        <div>
          <h3 className="font-medium text-xs uppercase tracking-wider text-ink/50 mb-1">Inputs</h3>
          <ul className="space-y-0.5 text-ink/80">
            {inputs.map((inp, i) => <li key={i}>· {inp}</li>)}
          </ul>
        </div>
        <div>
          <h3 className="font-medium text-xs uppercase tracking-wider text-ink/50 mb-1">Approach</h3>
          <p className="text-ink/80 leading-relaxed">{approach}</p>
        </div>
      </div>

      <div className="mt-2">{children}</div>
    </section>
  )
}

function LabelTable({ info, weights, unverifiableNote }) {
  return (
    <div className="mt-3">
      <h3 className="font-medium text-sm mb-1.5">Labels &amp; weights</h3>
      <table className="text-sm w-full max-w-lg">
        <tbody className="divide-y divide-sunrise-100">
          {Object.entries(info).map(([k, meta]) => {
            const w = weights[k]
            return (
              <tr key={k}>
                <td className="py-1.5 pr-2"><span className={`pill ${meta.cls}`}>{meta.display}</span></td>
                <td className="py-1.5 text-right font-mono text-ink/70">
                  {typeof w === 'number' ? w.toFixed(1) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {unverifiableNote && (
        <p className="text-xs text-ink/60 mt-2">{unverifiableNote}</p>
      )}
    </div>
  )
}

function ScoreFormula({ label, children }) {
  return (
    <div className="mt-4 p-3 rounded-xl bg-sunrise-50 border border-sunrise-200">
      <div className="text-[10px] uppercase tracking-wider text-ink/50 mb-1">{label}</div>
      <div className="font-mono text-sm text-ink/90">{children}</div>
    </div>
  )
}
