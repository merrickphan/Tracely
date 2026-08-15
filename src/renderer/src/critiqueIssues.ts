/*
 * A leaf module, like normalizeCritique.ts and inlineCitation.ts.
 *
 * Lifted out of OverlayApp.tsx so `npm test` can load it: that file imports
 * React and the IPC contract, and Node's type-stripping resolver cannot
 * follow either. It shipped untested, and the bug in the comment below
 * survived in it precisely because nothing could exercise it.
 */

/**
 * Reads a critique back as the design's issue rows.
 *
 * The "Critique Argument Result" frame draws three rows, each a short title
 * over a sentence of detail. The relay returns ONE prose paragraph under 120
 * words (see CRITIQUE_SYSTEM_PROMPT), so that shape is something the data
 * sometimes has and sometimes doesn't. This reads whatever structure the model
 * actually produced — markdown bullets, numbered points, or blank-line
 * separated paragraphs — and otherwise returns a single row with the prose
 * intact. Chopping a paragraph into sentences to reach three rows would be
 * inventing issues the critique never claimed to have found.
 *
 * A row with no detected title returns an empty one; the card fills it with
 * the verdict, so the prose always renders as body text rather than being
 * ellipsised into a heading.
 */
export function critiqueIssues(critique: string): Array<{ title: string; detail: string }> {
  const text = critique.trim()
  if (!text) return []

  // `\*(?!\*)` — a bullet asterisk is one asterisk. The class used to be
  // `[-*•]`, which matched the FIRST character of `**Bold heading**` and
  // stripped it, leaving `*Bold heading**` behind. The `^\*\*` test below then
  // failed on every block, so the bold-title branch was unreachable dead code:
  // any critique that opened with a markdown heading rendered with the heading
  // mangled into its own body text and the verdict standing in as the title.
  // Found by rendering a critique that used one.
  const blocks = text
    .split(/\n\s*\n|\n(?=[ \t]*(?:[-•]|\*(?!\*)|\d+[.)])[ \t])/)
    .map((block) => block.replace(/^[ \t]*(?:[-•]|\*(?!\*)|\d+[.)])[ \t]*/, '').trim())
    .filter(Boolean)

  return (blocks.length ? blocks : [text]).map((block) => {
    const bold = /^\*\*(.+?)\*\*\s*[:.—-]?\s*/.exec(block)
    if (bold && block.length > bold[0].length) {
      return { title: bold[1].trim(), detail: block.slice(bold[0].length).trim() }
    }
    const sentenceEnd = /[.?!]\s/.exec(block)
    if (sentenceEnd && sentenceEnd.index < 80 && block.length > sentenceEnd.index + 2) {
      return {
        title: block.slice(0, sentenceEnd.index + 1).trim(),
        detail: block.slice(sentenceEnd.index + 2).trim()
      }
    }
    return { title: '', detail: block }
  })
}
