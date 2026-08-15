import { useEffect, useState } from 'react'
import type {
  CitationStyle,
  Claim,
  DocumentOutline,
  EvidenceItem,
  ParagraphRole,
  Source,
  StructureComponents
} from '@shared/types'
import { tracelyApi } from '../lib/api'
import MarkdownText from './MarkdownText'
import Spinner from './Spinner'
import { gradeFor } from './essayGrade'

/**
 * What the document editor's "AI Insights" button opens.
 *
 * Figma "Real Tracely UI" (k7R5x1M9alKktaMLlZFSJn), four frames and the routing
 * between them — Merrick's spec, 2026-08-15:
 *
 *   353:129  Argument check ("SA Grid")   — WHAT AI INSIGHTS OPENS
 *   370:135  Essay Grade Widget           — the compact card, via Back
 *   404:129  Full Report — Expanded       — via "View Full Report"
 *   407:143  Paragraph Detail             — clicking any paragraph
 *   409:141  Find Evidence Result         — via "Find evidence" on a claim
 *
 * The landing view has moved three times and the history is the point: #46
 * opened the compact widget, #47 opened the full report on his instruction,
 * #48 went back to compact when he sent the frame, and on 2026-08-15 he asked
 * for "the OverlayMockup SAGrid widget". No frame carries that name — 353:129
 * is the only one in the file with a BREAKDOWN metrics grid (Support /
 * Relevance / Quality / Recency), and it was previously reachable ONLY via
 * "Open Argument Check", which matches "it's not doing that right now".
 *
 * Back from there lands on the Essay Grade widget rather than the full report,
 * because there is no screen you came from any more; the widget is the hub the
 * other views hang off.
 *
 * THE LABELS ARE THE DESIGN'S. This is the correction to the mistake that ran
 * through PRs #46-#50 and is worth writing down, because it was invisible from
 * inside every one of them.
 *
 * This file used to say the opposite: that the frames grade an essay and Tracely
 * measures how an argument is built, so it would keep the rubric's own words and
 * drop the design's — no "Essay Grade" title, no letter chip, no cohort line.
 * Defensible in isolation. What it meant in practice is that four PRs in a row
 * "fixed" which frame the buttons ROUTED to while the card those routes led to
 * never looked like the frame at all. Merrick kept saying "make it this frame"
 * and screenshotting 370:135; the routing kept getting fixed; the screen kept
 * not changing. Asked why, the honest answer was this paragraph.
 *
 * So: the title is "Essay Grade", the chip is a letter, the buttons read "View
 * Full Report" / "Back to Summary" / "Re-grade Essay". A letter grade is a
 * presentation of `outline.score`, which is a real number the rubric computes —
 * see GRADE_BANDS, whose bands are set so 82 reads B+ exactly as the frame does.
 *
 * ONE line in these frames is not a presentation of anything Tracely has:
 * "Above average for this assignment type" asserts a comparison against other
 * students' work, and there is no cohort and no assignment type to compare
 * against. That slot keeps the design's position, size and weight and says what
 * the score band means instead. Everything else on 370:135 and 404:129 is the
 * design's, verbatim.
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

/**
 * The letter on the chip, and the line under it.
 *
 * Both are presentations of `outline.score` — the rubric number scoreDraft.ts
 * already computes — and nothing else. The bands are set so 82 reads B+, which
 * is what the design's own frame shows for 82.
 *
 * The design's line there is "Above average for this assignment type". That one
 * is not a presentation of anything: it asserts a comparison against other
 * students' work on the same assignment, and Tracely has no cohort, no
 * assignment type, and no way to acquire either. It is the single sentence in
 * these frames that cannot be made true by rendering it, so the slot keeps the
 * design's position, size and weight and says what the band actually means.
 */
// Moved to ./essayGrade so the Screen Watch overlay's 'grade' panel can draw
// the same band against the same score. That window loads no stylesheet and so
// cannot import this component; a pure module is the only thing both can share.


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

/**
 * Which view is showing. `paragraph` carries the 1-based index it is showing;
 * `evidence` the claim whose sources it is listing, and the paragraph to go
 * back to — the design reaches Find Evidence from a paragraph detail, so Back
 * has to return there rather than to the report.
 */
type View =
  | { name: 'summary' }
  | { name: 'full' }
  | { name: 'paragraph'; index: number }
  | { name: 'argument' }
  | { name: 'evidence'; claimId: string; fromParagraph: number }

export default function ArgumentScoreModal({
  outline,
  claims,
  paragraphTexts,
  loading,
  error,
  citationStyle,
  onInsertCitation,
  onReanalyze,
  onClose
}: {
  outline: DocumentOutline | null
  claims: Claim[]
  paragraphTexts: string[]
  loading: boolean
  error: string | null
  /** The user's configured style — shown on the pill and used to format. */
  citationStyle: CitationStyle
  /**
   * Writes a citation into the document at the end of the claim's sentence.
   *
   * Passed in rather than done here because only the editor owns the
   * contentEditable, and null on surfaces that have no document to write to
   * (the paste-text flow) — where the button is not offered at all rather than
   * offered and inert.
   */
  onInsertCitation: ((claim: Claim, source: Source, style: CitationStyle) => Promise<void>) | null
  onReanalyze: () => void
  onClose: () => void
}): JSX.Element {
  // Opens on the Argument check card — 353:129, the frame with the BREAKDOWN
  // metrics grid (Support / Relevance / Quality / Recency).
  //
  // This landing view has now moved three times, so the history matters: #46
  // opened the compact Essay Grade widget, #47 opened the full report on his
  // instruction, #48 went back to compact when he sent the frame, and on
  // 2026-08-15 he asked for "the OverlayMockup SAGrid widget" instead. No frame
  // carries that name; 353:129 is the only one in the file with a metrics grid,
  // and it was previously reachable ONLY through "Open Argument Check", which
  // fits "it's not doing that right now" exactly.
  //
  // Everything else is still reached from here, and the Essay Grade widget is
  // still one click away. Do not move this again without him naming the frame.
  const [view, setView] = useState<View>({ name: 'argument' })

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
        ) : view.name === 'evidence' ? (
          <FindEvidenceResult
            claim={claims.find((c) => c.id === view.claimId) ?? null}
            citationStyle={citationStyle}
            onInsertCitation={onInsertCitation}
            onBack={() => setView({ name: 'paragraph', index: view.fromParagraph })}
            onClose={onClose}
          />
        ) : view.name === 'paragraph' ? (
          <ParagraphDetail
            outline={outline}
            claims={claims}
            paragraphTexts={paragraphTexts}
            index={view.index}
            onFindEvidence={(claimId) =>
              setView({ name: 'evidence', claimId, fromParagraph: view.index })
            }
            onBack={() => setView({ name: 'summary' })}
            onClose={onClose}
          />
        ) : view.name === 'argument' ? (
          /* Back lands on the Essay Grade widget, not the full report. This is
             the view AI Insights opens now, so "back" cannot mean "the screen
             you came from" — there isn't one. The widget is the hub every
             other view hangs off, so that is where it leads. */
          <ArgumentCheck claims={claims} onBack={() => setView({ name: 'summary' })} onClose={onClose} />
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
  const { detected, withRelevantSource, withOwnCitation, unchecked } = outline.coverage
  const checked = detected - unchecked
  const { words, sentences, uniqueWords } = readingStats(paragraphTexts)
  const grade = gradeFor(outline.score)

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
      <ModalHead title="Essay Grade" onClose={onClose} />

      <div className="argscore-summary">
        {/*
          No ring, no letter, no number when the rubric does not apply.

          `applicable` is false for a draft under MIN_PARAGRAPHS_FOR_RUBRIC
          paragraphs, where four of the six components are unreachable because
          the body slice is empty — the ceiling is 20/100 and every such draft
          renders as "F — Not yet arguing anything the rubric can find". That
          sentence was shown to a strong nine-sentence position paper with five
          citations in it. It was not a wrong grade so much as an answer to a
          question the writer never asked, and the F is the part they remember.

          Deliberately not a low-confidence grade or a greyed-out ring: this
          panel's whole stance is that a number computed from nothing is worse
          than no number, which is what `complete`/"Provisional" already says
          one notch down. The paragraph-level marks are unaffected and still
          carry everything Tracely actually knows about this text.
        */}
        {!outline.applicable ? (
          <div className="argscore-summary-text">
            <span className="argscore-eyebrow">Not enough draft to grade</span>
            <p className="argscore-grade-line">
              This rubric scores how an argument is built across paragraphs — its thesis, its body
              claims, whether it meets an objection, how it closes. There is not enough draft here
              to read any of that yet, so there is no grade to give.
            </p>
            <p className="argscore-grade-line">
              Everything below still applies: the claims in this text, their sources, and anything
              that needs a citation.
            </p>
          </div>
        ) : (
          <>
        <ScoreRing score={outline.score} size={compact ? 132 : 96} />
        <div className="argscore-summary-text">
          <span className="argscore-eyebrow">Overall score</span>
          <span className={`argscore-grade tone-${toneFor(outline.score)}`}>{grade.letter}</span>
          <p className="argscore-grade-line">{grade.line}</p>
          {!outline.complete ? <span className="argscore-provisional">Provisional</span> : null}
          {/*
            THREE different facts, never one number. This line said "0 of 7
            claims have a source" about drafts that were fully cited, which is
            an accusation, and the least believable thing the panel can print
            over an essay whose every paragraph carries a reference.

            - `withOwnCitation` — citations the WRITER wrote, from
              hasInlineCitation. A fact about the draft, knowable with no
              search at all, so it leads.
            - `withRelevantSource` — what TRACELY'S search turned up. A fact
              about retrieval. It stays on its own line and is never phrased as
              "has a source", because Tracely failing to find a paper is not
              the same as the claim being unsourced.
            - `unchecked` — claims no search has run on. Stated separately and
              never folded into a ratio, so the number cannot imply a search
              has run when it has not.

            Collapsing any two of these is how the bug happened. Keep them apart.
          */}
          {/* Not on the compact widget. 370:135 is a ring, an eyebrow, a grade
              and one line — nothing else — and the claim counts pushed it two
              rows taller than the frame. They live in the full report, which
              has the room the design gave it. */}
          {!compact ? (
            <p className="argscore-verdict">
              {detected === 0 ? (
                'No checkable claims in this draft yet.'
              ) : (
                <>
                  <b>
                    {withOwnCitation} of {detected}
                  </b>{' '}
                  {detected === 1 ? 'claim carries' : 'claims carry'} a citation you wrote
                </>
              )}
            </p>
          ) : null}
          {!compact && detected > 0 ? (
            <p className="argscore-verdict-sub">
              {checked === 0 ? (
                'Not checked against the literature yet.'
              ) : (
                <>
                  Tracely found supporting evidence for {withRelevantSource} of the {checked} it
                  checked
                  {unchecked > 0 ? (
                    <span className="argscore-unchecked"> · {unchecked} not checked yet</span>
                  ) : null}
                </>
              )}
            </p>
          ) : null}
        </div>
          </>
        )}
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
                Open Argument Check →
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
              {/* Suppressed with the grade, not just alongside it. These read
                  `outline.components`, which scoreDraft zeroes when the rubric
                  does not apply — so leaving them in prints a column of 0%
                  bars, which says "you scored nothing" more emphatically than
                  the letter it replaced. */}
              {outline.applicable
                ? keys.map((key) => {
                    const meta = COMPONENT_LABEL.find(([k]) => k === key)!
                    return (
                      <ComponentBar key={key} value={outline.components[key]} max={meta[2]} label={meta[1]} />
                    )
                  })
                : null}
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

      {/* The frames' own labels and shapes: a filled orange-gradient pill beside
          an outlined white one, both full-height, splitting the width. */}
      <footer className="argscore-foot">
        {compact ? (
          <button className="argscore-btn primary" onClick={() => onView({ name: 'full' })}>
            View Full Report
          </button>
        ) : (
          <button className="argscore-btn primary" onClick={() => onView({ name: 'summary' })}>
            Back to Summary
          </button>
        )}
        <button className="argscore-btn secondary" onClick={onReanalyze}>
          Re-grade Essay
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
  onFindEvidence,
  onBack,
  onClose
}: {
  outline: DocumentOutline
  claims: Claim[]
  paragraphTexts: string[]
  index: number
  onFindEvidence: (claimId: string) => void
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
            <button className="argscore-link" onClick={() => onFindEvidence(claim.id)}>
              Find evidence →
            </button>
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
                {/* On the checked claims too, not just the uncited ones: the
                    view lists the sources already found, so this is "show me
                    what that score is made of" as much as it is a search. */}
                <button className="argscore-link" onClick={() => onFindEvidence(claim.id)}>
                  Find evidence →
                </button>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </>
  )
}

/**
 * 409:141 — the sources found for one claim, reached by "Find evidence" on a
 * claim in the paragraph detail.
 *
 * Ranked by relevance, which is what the design's "% match" is: `relevanceScore`
 * as a percentage, the same number the strength breakdown is built from. It is
 * NOT a probability the source proves the claim, and the copy says "supports"
 * rather than "proves" for that reason.
 */
function FindEvidenceResult({
  claim,
  citationStyle,
  onInsertCitation,
  onBack,
  onClose
}: {
  claim: Claim | null
  citationStyle: CitationStyle
  onInsertCitation: ((claim: Claim, source: Source, style: CitationStyle) => Promise<void>) | null
  onBack: () => void
  onClose: () => void
}): JSX.Element {
  const [evidence, setEvidence] = useState<EvidenceItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [inserted, setInserted] = useState(false)

  // Read what is already stored before searching anything. A claim reached from
  // the report has usually been checked already, and re-running the four
  // academic APIs to redraw a list we hold would make opening this view cost a
  // 15-45 second wait for nothing.
  useEffect(() => {
    if (!claim) return
    let cancelled = false
    void tracelyApi
      .getEvidenceForClaim(claim.id)
      .then((res) => {
        if (cancelled) return
        setEvidence(res.evidence)
        setSelected(res.evidence[0]?.source.id ?? null)
      })
      .catch(() => {
        if (!cancelled) setEvidence([])
      })
    return () => {
      cancelled = true
    }
  }, [claim])

  async function search(): Promise<void> {
    if (!claim) return
    setSearching(true)
    setFailure(null)
    try {
      const res = await tracelyApi.findEvidence(claim.id)
      setEvidence(res.evidence)
      setSelected(res.evidence[0]?.source.id ?? null)
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err))
    } finally {
      setSearching(false)
    }
  }

  async function insert(): Promise<void> {
    const source = evidence?.find((item) => item.source.id === selected)?.source
    if (!claim || !source || !onInsertCitation) return
    setFailure(null)
    try {
      await onInsertCitation(claim, source, citationStyle)
      setInserted(true)
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err))
    }
  }

  const found = evidence?.length ?? 0
  const previewUrl = evidence?.find((item) => item.source.id === selected)?.source.url ?? null

  return (
    <>
      <ModalHead title="" onBack={onBack} onClose={onClose} />
      <div className="argscore-scroll argscore-detail">
        {!claim ? (
          <p className="muted">That claim is no longer part of this analysis.</p>
        ) : (
          <>
            <div className="argev-head">
              <span className={`argev-dot${found > 0 ? ' found' : ''}`} />
              <h2 className="argev-title">
                {evidence === null ? 'Looking…' : `${found} source${found === 1 ? '' : 's'} found`}
              </h2>
              <span className="argev-style">{citationStyle}</span>
            </div>
            <p className="argev-sub">
              Ranked by how directly each source supports “{claim.text}”
            </p>

            {failure ? <p className="error-text">{failure}</p> : null}

            {evidence !== null && found === 0 ? (
              <p className="muted argev-empty">
                Nothing in the open-access databases came back for this claim. They index journal
                articles — not news, government pages or statistics offices — so this is often a gap
                in the corpus rather than a problem with the sentence.
              </p>
            ) : null}

            {(evidence ?? []).map((item) => (
              <button
                type="button"
                key={item.source.id}
                className={`argev-row${selected === item.source.id ? ' selected' : ''}`}
                onClick={() => setSelected(item.source.id)}
              >
                <span className="argev-badge">{initialsFor(item.source)}</span>
                <span className="argev-meta">
                  <span className="argev-source-title">{item.source.title}</span>
                  <span className="argev-source-sub">
                    {item.source.venue ?? 'Unknown venue'}
                    {item.source.year ? ` · ${item.source.year}` : ''}
                    <span className="argev-match"> {Math.round(item.relevanceScore * 100)}% match</span>
                  </span>
                </span>
                <span className={`argev-radio${selected === item.source.id ? ' on' : ''}`} aria-hidden="true" />
              </button>
            ))}

            <div className="argev-actions">
              {onInsertCitation ? (
                <button
                  className="argscore-btn primary argev-insert"
                  onClick={() => void insert()}
                  disabled={!selected || inserted}
                >
                  {inserted ? 'Citation inserted' : 'Insert citation'}
                </button>
              ) : null}
              <button
                className="argscore-btn secondary"
                onClick={() => previewUrl && window.open(previewUrl, '_blank', 'noopener')}
                disabled={!previewUrl}
              >
                Preview
              </button>
            </div>
            <button className="argscore-btn secondary argev-again" onClick={() => void search()} disabled={searching}>
              {searching ? 'Searching…' : 'Search again'}
            </button>
          </>
        )}
      </div>
    </>
  )
}

/** The badge monogram: an acronym for a multi-word venue, else its first two letters. */
function initialsFor(source: Source): string {
  const name = source.venue ?? source.title
  const words = name.split(/\s+/).filter((w) => /[A-Za-z]/.test(w))
  if (words.length >= 2) {
    return words
      .slice(0, 3)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('')
  }
  return (words[0] ?? name).slice(0, 2).toUpperCase()
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
          ← Essay Grade
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
                {/* Through MarkdownText, like every other surface that shows a
                    critique. The relay's prompts neither request nor forbid
                    markdown and the model emits it freely, so rendering the raw
                    string printed literal ** around the emphasis. */}
                <div className="argscore-weakness-block">
                  <MarkdownText>{weakest.critique}</MarkdownText>
                </div>
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
