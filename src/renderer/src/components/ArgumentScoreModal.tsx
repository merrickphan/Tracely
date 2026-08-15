import { useState } from 'react'
import type { Claim, DocumentOutline, ParagraphRole, StructureComponents } from '@shared/types'
import Spinner from './Spinner'

/**
 * What the document editor's "AI Insights" button opens.
 *
 * Figma "Real Tracely UI" (k7R5x1M9alKktaMLlZFSJn), four frames and the routing
 * between them — Merrick's spec, 2026-08-15:
 *
 *   370:135  Essay Grade Widget           — the compact card
 *   404:129  Full Report — Expanded       — WHAT OPENS FIRST
 *   407:143  Paragraph Detail             — clicking any paragraph
 *   353:129  Argument Score Card          — ONLY via "Open argument check"
 *
 * Opening straight into the full report is deliberate and reverses PR #46,
 * which opened compact-first on my own reading of 370:135. His: the full report
 * is the thing you asked for, the compact card is where you land coming *back*.
 *
 * "Back to summary" goes to the COMPACT widget from anywhere, including from a
 * paragraph detail you reached via the full report. That skips a step you might
 * expect to return through — his call, and it matches the design putting the
 * identical label in both places.
 *
 * The labels throughout are the rubric's own, not the design's. Those frames
 * grade an essay (Thesis Clarity, Grammar & Mechanics, a B+ chip, "above
 * average for this assignment type"); Tracely measures how an argument is built
 * and none of that. So no letter grade — there is no band — and no cohort line,
 * because there is no cohort.
 */

const ROLE_LABEL: Record<ParagraphRole, string> = {
  thesis: 'Thesis',
  claim: 'Claim',
  evidence: 'Evidence',
  reasoning: 'Reasoning',
  significance: 'Significance',
  counterargument: 'Counterargument',
  conclusion: 'Conclusion',
  transition: 'Transition',
  unknown: 'Unlabelled'
}

const COMPONENT_LABEL: Array<[keyof StructureComponents, string, number]> = [
  ['thesis', 'Thesis', 20],
  ['governingClaims', 'Governing claims', 20],
  ['warrant', 'Reasoning markers', 20],
  ['counterargument', 'Counterargument', 15],
  ['significance', 'Significance', 15],
  ['conclusion', 'Conclusion', 10]
]

/**
 * Which rubric components belong beside which paragraph role.
 *
 * These are DOCUMENT-level components — scoreDraft.ts scores the draft, not
 * each paragraph — so each renders exactly ONCE, against the first paragraph
 * carrying its role. Repeating a bar down every evidence paragraph would imply
 * each was scored alone, which this rubric does not do.
 */
const ROLE_COMPONENTS: Partial<Record<ParagraphRole, Array<keyof StructureComponents>>> = {
  thesis: ['thesis'],
  claim: ['governingClaims'],
  evidence: ['governingClaims', 'warrant'],
  reasoning: ['warrant'],
  counterargument: ['counterargument'],
  significance: ['significance'],
  conclusion: ['conclusion', 'significance']
}

function toneFor(score: number): 'good' | 'mid' | 'low' {
  return score >= 70 ? 'good' : score >= 40 ? 'mid' : 'low'
}

function verdictFor(pct: number): string {
  return pct >= 70 ? 'Strong' : pct >= 40 ? 'Developing' : 'Needs work'
}

/** 238 wpm — Brysbaert 2019, silent reading of English prose. */
const READING_WPM = 238

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th']

function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length
}

function readingStats(paragraphTexts: string[]): { words: number; sentences: number; uniqueWords: number } {
  const text = paragraphTexts.join('\n\n')
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []
  return {
    words: words.length,
    // Floors at 1 so words-per-sentence cannot divide by zero.
    sentences: Math.max(1, (text.match(/[.!?]+(?=\s|$)/g) ?? []).length),
    uniqueWords: new Set(words.map((w) => w.toLocaleLowerCase())).size
  }
}

function ScoreRing({ score, size }: { score: number; size: number }): JSX.Element {
  const stroke = size >= 120 ? 9 : 7
  const radius = size / 2 - stroke
  const circumference = 2 * Math.PI * radius
  const filled = (Math.max(0, Math.min(100, score)) / 100) * circumference
  return (
    <svg
      className={`argscore-ring tone-${toneFor(score)}`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Argument score ${score} of 100`}
    >
      <circle className="argscore-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
      <circle
        className="argscore-ring-fill"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={stroke}
        strokeDasharray={`${filled} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text className="argscore-ring-score" x="50%" y="47%" textAnchor="middle" dominantBaseline="middle">
        {score}
      </text>
      <text className="argscore-ring-max" x="50%" y="68%" textAnchor="middle">
        / 100
      </text>
    </svg>
  )
}

function ComponentBar({ value, max, label }: { value: number; max: number; label: string }): JSX.Element {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="argscore-bar" title={`${label}: ${Math.round(value)} of ${max}`}>
      <span className="argscore-bar-label">{label}</span>
      <span className="argscore-bar-pct">{Math.round(pct)}%</span>
      <span className="argscore-bar-track">
        <span className={`argscore-bar-fill tone-${toneFor(pct)}`} style={{ width: `${pct}%` }} />
      </span>
    </div>
  )
}

/** Which view is showing. `paragraph` carries the 1-based index it is showing. */
type View = { name: 'summary' } | { name: 'full' } | { name: 'paragraph'; index: number } | { name: 'argument' }

export default function ArgumentScoreModal({
  outline,
  claims,
  paragraphTexts,
  loading,
  error,
  onReanalyze,
  onClose
}: {
  outline: DocumentOutline | null
  claims: Claim[]
  paragraphTexts: string[]
  loading: boolean
  error: string | null
  onReanalyze: () => void
  onClose: () => void
}): JSX.Element {
  // Opens on the full report, per the spec. Not compact-first.
  const [view, setView] = useState<View>({ name: 'full' })

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Argument score">
      <div className="modal-card argscore-card">
        {loading ? (
          <div className="argscore-state">
            <Spinner />
            <p>Reading the draft…</p>
          </div>
        ) : error ? (
          <div className="argscore-state">
            <p className="error-text">{error}</p>
            <button className="argscore-btn secondary" onClick={onReanalyze}>
              Try again
            </button>
          </div>
        ) : !outline ? (
          <div className="argscore-state">
            <p>No reading yet.</p>
            <p className="muted">
              The rubric needs a few paragraphs of prose before it has an opinion worth showing.
            </p>
            <button className="argscore-btn secondary" onClick={onReanalyze}>
              Check again
            </button>
          </div>
        ) : view.name === 'paragraph' ? (
          <ParagraphDetail
            outline={outline}
            claims={claims}
            paragraphTexts={paragraphTexts}
            index={view.index}
            onBack={() => setView({ name: 'summary' })}
            onClose={onClose}
          />
        ) : view.name === 'argument' ? (
          <ArgumentCheck claims={claims} onBack={() => setView({ name: 'full' })} onClose={onClose} />
        ) : (
          <ScoreReport
            outline={outline}
            claims={claims}
            paragraphTexts={paragraphTexts}
            compact={view.name === 'summary'}
            onView={setView}
            onReanalyze={onReanalyze}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  )
}

function ModalHead({
  title,
  onBack,
  onClose
}: {
  title: string
  onBack?: () => void
  onClose: () => void
}): JSX.Element {
  return (
    <header className="argscore-head">
      {onBack ? (
        <button className="argscore-back" onClick={onBack}>
          ← Back to summary
        </button>
      ) : (
        <h2 className="argscore-title">{title}</h2>
      )}
      <button className="argscore-close" onClick={onClose} aria-label="Close">
        ×
      </button>
    </header>
  )
}

/** 370:135 when compact, 404:129 when not. Same header, the report body appears. */
function ScoreReport({
  outline,
  claims,
  paragraphTexts,
  compact,
  onView,
  onReanalyze,
  onClose
}: {
  outline: DocumentOutline
  claims: Claim[]
  paragraphTexts: string[]
  compact: boolean
  onView: (view: View) => void
  onReanalyze: () => void
  onClose: () => void
}): JSX.Element {
  const { detected, withRelevantSource } = outline.coverage
  const { words, sentences, uniqueWords } = readingStats(paragraphTexts)

  const claimed = new Set<keyof StructureComponents>()
  const rows = outline.paragraphs.map((paragraph) => {
    const keys = (ROLE_COMPONENTS[paragraph.role] ?? []).filter((key) => !claimed.has(key))
    keys.forEach((key) => claimed.add(key))
    const pcts = keys.map((key) => {
      const meta = COMPONENT_LABEL.find(([k]) => k === key)!
      return (outline.components[key] / meta[2]) * 100
    })
    return {
      paragraph,
      keys,
      verdict: pcts.length > 0 ? verdictFor(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null,
      weaknesses: outline.weaknesses.filter((w) => w.paragraphIndex === paragraph.index)
    }
  })
  const missing = COMPONENT_LABEL.filter(([key]) => !claimed.has(key))
  const draftWeaknesses = outline.weaknesses.filter((w) => w.paragraphIndex === null)

  return (
    <>
      <ModalHead title="Argument Score" onClose={onClose} />

      <div className="argscore-summary">
        <ScoreRing score={outline.score} size={compact ? 132 : 96} />
        <div className="argscore-summary-text">
          <span className="argscore-eyebrow">Overall score</span>
          {!outline.complete ? <span className="argscore-provisional">Provisional</span> : null}
          <p className="argscore-verdict">
            {detected === 0
              ? 'No checkable claims in this draft yet.'
              : `${withRelevantSource} of ${detected} ${detected === 1 ? 'claim has' : 'claims have'} a source.`}
          </p>
        </div>
      </div>

      {!compact ? (
        <div className="argscore-scroll">
          <div className="argscore-stats">
            <div>
              <b>{words.toLocaleString()}</b>
              <span>Words</span>
            </div>
            <div>
              <b>~{Math.max(1, Math.round(words / READING_WPM))} min</b>
              <span>Read time</span>
            </div>
            <div>
              <b>{(words / sentences).toFixed(1)}</b>
              <span>Words / sentence</span>
            </div>
            <div>
              <b>{Math.round((uniqueWords / Math.max(1, words)) * 100)}%</b>
              <span>Vocab diversity</span>
            </div>
          </div>

          <div className="argscore-section-row">
            <h3 className="argscore-section">Breakdown by paragraph</h3>
            {/* The ONLY route to the argument check, per the spec. It is a
                per-claim surface and does not belong in the paragraph flow. */}
            {claims.length > 0 ? (
              <button className="argscore-link" onClick={() => onView({ name: 'argument' })}>
                Open argument check →
              </button>
            ) : null}
          </div>

          {rows.map(({ paragraph, keys, verdict, weaknesses }) => (
            <button
              type="button"
              className="argscore-para"
              key={paragraph.index}
              data-role={paragraph.role}
              onClick={() => onView({ name: 'paragraph', index: paragraph.index })}
            >
              <div className="argscore-para-head">
                <span className="argscore-para-num">¶{paragraph.index}</span>
                <span className="argscore-para-role">{ROLE_LABEL[paragraph.role]}</span>
                {verdict ? (
                  <span className={`argscore-verdict-pill tone-${verdict === 'Strong' ? 'good' : verdict === 'Developing' ? 'mid' : 'low'}`}>
                    {verdict}
                  </span>
                ) : null}
              </div>
              <p className="argscore-para-preview">{paragraphTexts[paragraph.index - 1] ?? ''}</p>
              {keys.map((key) => {
                const meta = COMPONENT_LABEL.find(([k]) => k === key)!
                return <ComponentBar key={key} value={outline.components[key]} max={meta[2]} label={meta[1]} />
              })}
              {weaknesses.map((weakness, i) => (
                <span className="argscore-weakness" key={`${weakness.kind}-${i}`}>
                  {weakness.message}
                </span>
              ))}
            </button>
          ))}

          {missing.length > 0 ? (
            <>
              <h3 className="argscore-section">Not found in this draft</h3>
              <p className="argscore-missing">{missing.map(([, label]) => label).join(' · ')}</p>
            </>
          ) : null}

          {draftWeaknesses.length > 0 ? (
            <>
              <h3 className="argscore-section">Summary</h3>
              {draftWeaknesses.map((weakness, i) => (
                <p className="argscore-weakness-block" key={`${weakness.kind}-${i}`}>
                  {weakness.message}
                </p>
              ))}
            </>
          ) : null}
        </div>
      ) : null}

      <footer className="argscore-foot">
        {compact ? (
          <button className="argscore-btn primary" onClick={() => onView({ name: 'full' })}>
            View full report
          </button>
        ) : (
          <button className="argscore-btn primary" onClick={() => onView({ name: 'summary' })}>
            Back to summary
          </button>
        )}
        <button className="argscore-btn secondary" onClick={onReanalyze}>
          Re-check
        </button>
      </footer>
    </>
  )
}

/** 407:143. */
function ParagraphDetail({
  outline,
  claims,
  paragraphTexts,
  index,
  onBack,
  onClose
}: {
  outline: DocumentOutline
  claims: Claim[]
  paragraphTexts: string[]
  index: number
  onBack: () => void
  onClose: () => void
}): JSX.Element {
  const paragraph = outline.paragraphs.find((p) => p.index === index)
  const text = paragraphTexts[index - 1] ?? ''
  const weaknesses = outline.weaknesses.filter((w) => w.paragraphIndex === index)
  const paragraphClaims = claims.filter((claim) => paragraph?.claimIds.includes(claim.id))
  // "Uncited" is a null strengthScore — searched-and-found-nothing is a
  // different state and says so on the claim itself.
  const uncited = paragraphClaims.filter((claim) => claim.strengthScore === null)
  const cited = paragraphClaims.filter((claim) => claim.strengthScore !== null)

  const keys = paragraph ? ROLE_COMPONENTS[paragraph.role] ?? [] : []
  const pcts = keys.map((key) => {
    const meta = COMPONENT_LABEL.find(([k]) => k === key)!
    return (outline.components[key] / meta[2]) * 100
  })
  const verdict = pcts.length > 0 ? verdictFor(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null

  return (
    <>
      <ModalHead title="" onBack={onBack} onClose={onClose} />
      <div className="argscore-scroll argscore-detail">
        <h2 className="argscore-detail-title">
          Paragraph {index} — {paragraph ? ROLE_LABEL[paragraph.role] : 'Unlabelled'}
        </h2>
        <div className="argscore-detail-meta">
          {verdict ? (
            <span className={`argscore-verdict-pill tone-${verdict === 'Strong' ? 'good' : verdict === 'Developing' ? 'mid' : 'low'}`}>
              {verdict}
            </span>
          ) : null}
          <span>
            {countWords(text)} words · {ORDINAL[index - 1] ?? `${index}th`} paragraph
          </span>
        </div>

        <blockquote className="argscore-quote">{text}</blockquote>

        {weaknesses.length > 0 ? (
          <>
            <h3 className="argscore-section">Why this needs work</h3>
            {/* The rubric's own sentences. The design writes prose here and
                nothing on this path generates text — an invented paragraph
                would be the one part of this view that was not a reading of
                the draft. */}
            {weaknesses.map((weakness, i) => (
              <p className="argscore-weakness-block" key={`${weakness.kind}-${i}`}>
                {weakness.message}
              </p>
            ))}
          </>
        ) : null}

        {uncited.map((claim) => (
          <div className="argscore-uncited" key={claim.id}>
            <span className="argscore-uncited-label">Uncited claim</span>
            <p className="argscore-uncited-text">“{claim.text}”</p>
          </div>
        ))}

        {cited.length > 0 ? (
          <>
            <h3 className="argscore-section">Claims checked in this paragraph ({cited.length})</h3>
            {cited.map((claim) => (
              <div className="argscore-claim" key={claim.id}>
                <span className={`argscore-claim-score tone-${toneFor(claim.strengthScore ?? 0)}`}>
                  {claim.strengthScore}
                </span>
                <p>{claim.text}</p>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </>
  )
}

/**
 * 353:129 — per-CLAIM, which is why it is only reachable from the explicit
 * link and never from the paragraph flow.
 *
 * The design draws one claim. This shows the weakest checked claim, since that
 * is the one worth opening the view for, and says how many others there are
 * rather than silently picking one out of several.
 */
function ArgumentCheck({
  claims,
  onBack,
  onClose
}: {
  claims: Claim[]
  onBack: () => void
  onClose: () => void
}): JSX.Element {
  const checked = claims.filter((claim) => claim.strengthScore !== null)
  const weakest = checked.slice().sort((a, b) => (a.strengthScore ?? 0) - (b.strengthScore ?? 0))[0] ?? null

  return (
    <>
      <header className="argscore-head">
        <button className="argscore-back" onClick={onBack}>
          ← Back to report
        </button>
        <button className="argscore-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <div className="argscore-scroll argscore-detail">
        <h2 className="argscore-detail-title">Argument check</h2>
        {!weakest ? (
          <p className="muted">
            No claim has been checked yet. Run an evidence search on a claim and its strength appears here.
          </p>
        ) : (
          <>
            <p className="argscore-quote">“{weakest.text}”</p>
            <div className="argscore-strength">
              <span className="argscore-eyebrow">Argument strength</span>
              <span className={`argscore-strength-score tone-${toneFor(weakest.strengthScore ?? 0)}`}>
                {weakest.strengthScore}
                <small> /100</small>
              </span>
            </div>
            {weakest.scoreBreakdown ? (
              <div className="argscore-breakdown">
                <ComponentBar value={weakest.scoreBreakdown.support * 100} max={100} label="Support" />
                <ComponentBar value={weakest.scoreBreakdown.relevance * 100} max={100} label="Relevance" />
                <ComponentBar value={weakest.scoreBreakdown.quality * 100} max={100} label="Quality" />
                <ComponentBar value={weakest.scoreBreakdown.recency * 100} max={100} label="Recency" />
              </div>
            ) : null}
            {weakest.critique ? (
              <>
                <h3 className="argscore-section">Critique</h3>
                <p className="argscore-weakness-block">{weakest.critique}</p>
              </>
            ) : null}
            {checked.length > 1 ? (
              <p className="argscore-footnote">
                Showing the weakest of {checked.length} checked claims. The rest are under the document.
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}
