import type { DocumentOutline, ParagraphRole, StructureComponents } from '@shared/types'
import Spinner from './Spinner'

/**
 * The Structure rail: what the draft's argument is doing, what it scores, and
 * what is missing.
 *
 * The panel deliberately shows the role of every paragraph next to the score
 * rather than only the number. The score is a formula over those labels, so
 * displaying them is what makes it appealable — a student who disagrees can see
 * precisely which label cost them the points, instead of being handed a verdict
 * with no working shown.
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

// Ordered as the rubric reads, not by weight: a writer looks for "do I have a
// thesis" before "how are my warrants doing".
const COMPONENT_LABEL: Array<[keyof StructureComponents, string, number]> = [
  ['thesis', 'Thesis', 20],
  ['governingClaims', 'Governing claims', 20],
  ['warrant', 'Reasoning markers', 20],
  ['counterargument', 'Counterargument', 15],
  ['significance', 'Significance', 15],
  ['conclusion', 'Conclusion', 10]
]

/** The app's existing 70/40 bands, same as evidenceScoreColor in the overlay. */
function toneFor(score: number): 'good' | 'mid' | 'low' {
  return score >= 70 ? 'good' : score >= 40 ? 'mid' : 'low'
}

function CoverageLine({ outline }: { outline: DocumentOutline }): JSX.Element {
  const { detected, withRelevantSource, meanStrength, unchecked } = outline.coverage

  if (detected === 0) {
    return <p className="docedit-evidence-line muted">No checkable claims detected in this draft.</p>
  }

  return (
    <p className="docedit-evidence-line">
      <b>
        {withRelevantSource} of {detected}
      </b>{' '}
      {detected === 1 ? 'claim has' : 'claims have'} supporting sources
      {meanStrength !== null ? <> · mean strength {meanStrength}</> : null}
      {/* Stated explicitly rather than folded into the ratio. An unchecked
          claim is not an unsupported one, and the panel must not let a number
          imply the search has run when it hasn't. */}
      {unchecked > 0 ? <span className="muted"> · {unchecked} not checked</span> : null}
    </p>
  )
}

export default function StructurePanel({
  outline,
  paragraphTexts,
  stale,
  loading,
  error,
  activeParagraph,
  onAnalyze,
  onSelectParagraph,
  onClose
}: {
  outline: DocumentOutline | null
  /**
   * Paragraph text from the LIVE editor, split with the same shared splitter
   * main used. The outline carries no prose by design, so if the document has
   * been edited since, these will not line up — which is precisely what the
   * stale banner is warning about, and why the rows render live text rather
   * than a snapshot that would look authoritative while being wrong.
   */
  paragraphTexts: string[]
  stale: boolean
  loading: boolean
  error: string | null
  activeParagraph: number | null
  onAnalyze: () => void
  onSelectParagraph: (index: number) => void
  onClose: () => void
}): JSX.Element {
  return (
    <aside className="docedit-structure" aria-label="Structure">
      <div className="docedit-structure-head">
        <span className="docedit-structure-title">Structure</span>
        <button className="docedit-structure-close" onClick={onClose} aria-label="Hide structure">
          ×
        </button>
      </div>

      {error ? <p className="error-text docedit-structure-msg">{error}</p> : null}

      {!outline && !loading && !error ? (
        <div className="docedit-structure-empty">
          <p className="muted">
            Read this draft as an argument — what each paragraph is doing, where the reasoning
            thins out, and what is missing.
          </p>
          <button className="docedit-structure-run" onClick={onAnalyze}>
            Analyze structure
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="docedit-structure-loading">
          <Spinner />
          <span className="muted">Reading the draft…</span>
        </div>
      ) : null}

      {outline && !loading ? (
        <>
          {stale ? (
            <div className="docedit-structure-stale">
              <span>The draft has changed since this analysis.</span>
              <button className="docedit-structure-restale" onClick={onAnalyze}>
                Re-analyze
              </button>
            </div>
          ) : null}

          <div className="docedit-score">
            <div
              className="docedit-score-ring"
              data-tone={toneFor(outline.score)}
              style={{ ['--score-pct' as string]: `${outline.score}%` }}
              role="img"
              aria-label={`Structure score ${outline.score} out of 100`}
            >
              <span className="docedit-score-value">{outline.score}</span>
            </div>
            <div className="docedit-score-meta">
              <span className="docedit-score-label">Structure score</span>
              {/*
                A draft with unlabelled paragraphs has been scored on an
                incomplete reading, and saying so is the whole reason `complete`
                exists. Presenting 55/100 as settled when a third of the
                paragraphs were never classified is the failure this badge
                prevents.
              */}
              {!outline.complete ? (
                <span
                  className="docedit-score-provisional"
                  title="Some paragraphs could not be labelled, so parts of this score were counted as absent rather than assessed."
                >
                  Provisional
                </span>
              ) : null}
              <CoverageLine outline={outline} />
            </div>
          </div>

          <div className="docedit-score-bars">
            {COMPONENT_LABEL.map(([key, label, max]) => {
              const value = outline.components[key]
              return (
                <div className="docedit-score-bar" key={key}>
                  <span className="docedit-score-bar-label">{label}</span>
                  <span className="docedit-score-bar-track">
                    <span
                      className="docedit-score-bar-fill"
                      data-tone={toneFor((value / max) * 100)}
                      style={{ width: `${(value / max) * 100}%` }}
                    />
                  </span>
                  <span className="docedit-score-bar-value">
                    {Math.round(value)}/{max}
                  </span>
                </div>
              )
            })}
          </div>

          {outline.weaknesses.length > 0 ? (
            <div className="docedit-weaknesses">
              <h4 className="docedit-structure-subhead">
                What to fix ({outline.weaknesses.length})
              </h4>
              {outline.weaknesses.map((weakness, i) => (
                <div
                  className="docedit-weakness"
                  key={`${weakness.kind}-${weakness.paragraphIndex ?? 'draft'}-${i}`}
                >
                  {weakness.paragraphIndex !== null ? (
                    <button
                      className="docedit-weakness-jump"
                      onClick={() => onSelectParagraph(weakness.paragraphIndex as number)}
                    >
                      ¶{weakness.paragraphIndex}
                    </button>
                  ) : (
                    <span className="docedit-weakness-jump docedit-weakness-jump-draft">Draft</span>
                  )}
                  <span className="docedit-weakness-text">{weakness.message}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="docedit-structure-map">
            <h4 className="docedit-structure-subhead">Paragraphs</h4>
            {outline.paragraphs.map((paragraph) => (
              <button
                className="docedit-para-row"
                key={paragraph.index}
                data-role={paragraph.role}
                data-active={paragraph.index === activeParagraph ? 'true' : undefined}
                onClick={() => onSelectParagraph(paragraph.index)}
              >
                <span className="docedit-para-num">{paragraph.index}</span>
                <span className="docedit-para-role">{ROLE_LABEL[paragraph.role]}</span>
                <span className="docedit-para-preview">
                  {paragraphTexts[paragraph.index - 1] ?? ''}
                </span>
              </button>
            ))}
          </div>

          <p className="docedit-structure-foot muted">
            {outline.rolesFrom === 'heuristic'
              ? 'Labelled by local rules, which leave anything they cannot justify unlabelled.'
              : 'Labelled by Tracely, then scored by a fixed rubric.'}
          </p>
        </>
      ) : null}
    </aside>
  )
}
