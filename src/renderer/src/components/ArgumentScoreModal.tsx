import { useState } from 'react'
import type { Claim, DocumentOutline, ParagraphRole, StructureComponents } from '@shared/types'
import Spinner from './Spinner'

/**
 * What the document editor's "AI Insights" button opens.
 *
 * Figma "Real Tracely UI" (k7R5x1M9alKktaMLlZFSJn) frames 370:135 (compact) and
 * 404:129 (Full Report — Expanded). Those frames draw ONE `AI Insights` button
 * in a document toolbar — Bold / Italic / Font / Align / Share / More / Back —
 * which matches this editor's toolbar almost component-for-component. That is
 * the strongest evidence the Essay Grade modal was drawn for THIS surface, and
 * why it lives here rather than only in the Screen Watch overlay.
 *
 * Before this, `AI Insights` ran claim detection and appended a list of
 * ClaimCards under the document, while a second `Structure` button opened a
 * side rail. Two buttons, neither doing what the design shows the one button
 * doing — which is exactly what "the AI Insights button is glitched" meant.
 *
 * The labels are the rubric's own, not the design's. Those frames grade an
 * essay (Thesis Clarity, Grammar & Mechanics, Vocabulary & Word Choice, a B+
 * chip, "above average for this assignment type"); Tracely measures how an
 * argument is built and none of that. Merrick's call, 2026-08-14: score the
 * argument, rewrite the labels. So there is no letter grade — there is no band
 * — and no cohort comparison, because there is no cohort.
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
 * The design puts one or two metric bars inside each paragraph card. These are
 * DOCUMENT-level components — `scoreDraft.ts` scores the draft, not each
 * paragraph — so each renders exactly ONCE, against the first paragraph
 * carrying its role. Repeating a bar down every evidence paragraph would imply
 * each was scored on its own, which is not a thing this rubric does.
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

/**
 * 238 words per minute — Brysbaert 2019, silent reading of English prose. Named
 * rather than inlined so the number is arguable instead of looking arbitrary.
 */
const READING_WPM = 238

/**
 * Reading figures for the stats row.
 *
 * Computed right here, unlike the overlay's, because this surface HAS the
 * document text. The overlay never receives it — only one truncated line per
 * paragraph — which is why its equivalent had to be computed in main and sent
 * over IPC. Nothing to plumb on this side.
 */
function readingStats(paragraphTexts: string[]): {
  words: number
  sentences: number
  uniqueWords: number
} {
  const text = paragraphTexts.join('\n\n')
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []
  const terminators = text.match(/[.!?]+(?=\s|$)/g) ?? []
  return {
    words: words.length,
    // Floors at 1 so words-per-sentence cannot divide by zero on a draft with
    // no full stop yet.
    sentences: Math.max(1, terminators.length),
    uniqueWords: new Set(words.map((word) => word.toLocaleLowerCase())).size
  }
}

/** The design's ring. Drawn, not approximated — it is what a reader recognises. */
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
  /** Re-runs the structural read. Exists already on this surface — see runStructure. */
  onReanalyze: () => void
  onClose: () => void
}): JSX.Element {
  // Compact first, exactly as 370:135 draws it. The overlay's version always
  // rendered the full breakdown with nothing to click, which is the gap this
  // two-step closes.
  const [view, setView] = useState<'summary' | 'full'>('summary')

  return (
    // Reuses the app's existing dialog shell rather than a second one: the
    // backdrop is inset by --window-margin and rounded to 30px because this is a
    // frameless transparent window, and an `inset: 0` copy would paint four hard
    // corners outside the card's radius.
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Argument score">
      <div className="modal-card argscore-card">
        <header className="argscore-head">
          <h2 className="argscore-title">Argument Score</h2>
          <button className="argscore-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

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
          // Honest rather than a spinner that never resolves: the rubric needs
          // a few paragraphs of prose before it has anything to say.
          <div className="argscore-state">
            <p>No reading yet.</p>
            <p className="muted">
              The rubric needs a few paragraphs of prose before it has an opinion worth showing.
            </p>
            <button className="argscore-btn secondary" onClick={onReanalyze}>
              Check again
            </button>
          </div>
        ) : (
          <ScoreBody
            outline={outline}
            claims={claims}
            paragraphTexts={paragraphTexts}
            view={view}
            onView={setView}
            onReanalyze={onReanalyze}
          />
        )}
      </div>
    </div>
  )
}

function ScoreBody({
  outline,
  claims,
  paragraphTexts,
  view,
  onView,
  onReanalyze
}: {
  outline: DocumentOutline
  claims: Claim[]
  paragraphTexts: string[]
  view: 'summary' | 'full'
  onView: (view: 'summary' | 'full') => void
  onReanalyze: () => void
}): JSX.Element {
  const { detected, withRelevantSource } = outline.coverage
  const { words, sentences, uniqueWords } = readingStats(paragraphTexts)

  // Assigned as the list is built, so a component shown against ¶2 is not shown
  // again against ¶5. What is left over is the useful signal: a rubric
  // component whose role never appears in the draft at all.
  const claimed = new Set<keyof StructureComponents>()
  const rows = outline.paragraphs.map((paragraph) => {
    const keys = (ROLE_COMPONENTS[paragraph.role] ?? []).filter((key) => !claimed.has(key))
    keys.forEach((key) => claimed.add(key))
    return {
      paragraph,
      keys,
      weaknesses: outline.weaknesses.filter((w) => w.paragraphIndex === paragraph.index)
    }
  })
  const missing = COMPONENT_LABEL.filter(([key]) => !claimed.has(key))
  const draftWeaknesses = outline.weaknesses.filter((w) => w.paragraphIndex === null)

  return (
    <>
      <div className="argscore-summary">
        <ScoreRing score={outline.score} size={view === 'summary' ? 132 : 96} />
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

      {view === 'full' ? (
        <div className="argscore-scroll">
          {/* Reading figures, not judgements — they describe the draft without
              claiming anything about it, which is why they survived the relabel
              when the design's grade chip did not. */}
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

          <h3 className="argscore-section">Breakdown by paragraph</h3>
          {rows.map(({ paragraph, keys, weaknesses }) => (
            <div className="argscore-para" key={paragraph.index} data-role={paragraph.role}>
              <div className="argscore-para-head">
                <span className="argscore-para-num">¶{paragraph.index}</span>
                <span className="argscore-para-role">{ROLE_LABEL[paragraph.role]}</span>
                <span className="argscore-para-claims">
                  {paragraph.claimIds.length > 0
                    ? `${paragraph.claimIds.length} claim${paragraph.claimIds.length === 1 ? '' : 's'}`
                    : ''}
                </span>
              </div>
              <p className="argscore-para-preview">{paragraphTexts[paragraph.index - 1] ?? ''}</p>
              {keys.map((key) => {
                const meta = COMPONENT_LABEL.find(([k]) => k === key)!
                return (
                  <ComponentBar key={key} value={outline.components[key]} max={meta[2]} label={meta[1]} />
                )
              })}
              {weaknesses.map((weakness, i) => (
                <p className="argscore-weakness" key={`${weakness.kind}-${i}`}>
                  {weakness.message}
                </p>
              ))}
            </div>
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
              {/* The design writes prose here. These are the rubric's own
                  sentences instead: nothing on this path generates text, and a
                  summary invented to fill a slot would be the one part of the
                  panel that was not a reading of the draft. */}
              {draftWeaknesses.map((weakness, i) => (
                <p className="argscore-weakness" key={`${weakness.kind}-${i}`}>
                  {weakness.message}
                </p>
              ))}
            </>
          ) : null}

          {claims.length > 0 ? (
            <p className="argscore-footnote">
              {claims.length} claim{claims.length === 1 ? '' : 's'} detected — close this to see them under the
              document.
            </p>
          ) : null}
        </div>
      ) : null}

      <footer className="argscore-foot">
        {view === 'summary' ? (
          <button className="argscore-btn primary" onClick={() => onView('full')}>
            View full report
          </button>
        ) : (
          <button className="argscore-btn primary" onClick={() => onView('summary')}>
            Back to summary
          </button>
        )}
        {/* The overlay could not offer this — Screen Watch only re-reads on a
            text-stability debounce. Here runStructure() is already a manual
            call, so the design's button costs nothing new. */}
        <button className="argscore-btn secondary" onClick={onReanalyze}>
          Re-check
        </button>
      </footer>
    </>
  )
}
