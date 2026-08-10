// A deliberately small markdown subset, for rendering model output.
//
// Nothing in this app told the relay's prompts to avoid markdown, and nothing
// rendered it, so Tracer replies and critiques arrived with literal `**` around
// the words they meant to emphasise. Rendering it is the fix rather than
// stripping it: the model produced that structure on purpose, and a prompt
// change would need a relay deploy and still would not clean the critiques
// already sitting in `cacheRepo`.
//
// Why hand-written instead of `react-markdown`/`marked`:
//
//   - This is an offline-first local app. The subset an LLM actually emits in
//     a 180-word reply is bold, italics, code spans, bullets and short
//     headings — a few dozen lines, against a dependency tree.
//   - It emits a tree, never HTML. `MarkdownText` renders React elements from
//     it, so there is no `dangerouslySetInnerHTML` anywhere and no sanitiser to
//     get wrong. Untrusted model output cannot inject markup by construction.
//
// The governing rule for everything below is **an unmatched delimiter stays
// literal**. A reply containing a single stray `**` must render that `**` and
// nothing else differently — never swallow the rest of the message looking for
// a closer that isn't coming.
//
// Not handled, deliberately: blockquotes, tables, links, images, horizontal
// rules, nested lists. Each renders as its own source text, which is the same
// thing that happens today.

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }

export type Block =
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'heading'; children: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: InlineNode[][] }

/** Characters a backslash may escape, so `\*not italic\*` renders literally. */
const ESCAPABLE = '*_`\\'

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch)
}

function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch)
}

/**
 * Finds the index of the closing delimiter for an emphasis span.
 *
 * The two rejections matter more than the search:
 *
 *   - A closer may not be preceded by whitespace, so `** not emphasis **`
 *     stays literal — LLMs use bare `**` as a bullet-ish separator often
 *     enough that this is a real case, not a hypothetical.
 *   - A `_` closer may not be followed by a word character, which is what
 *     keeps `some_long_identifier` from turning into `some<em>long</em>ifier`.
 */
function findCloser(text: string, from: number, marker: string, ch: string): number {
  const width = marker.length
  for (let j = from; j <= text.length - width; j++) {
    if (text[j] === '\\') {
      j++
      continue
    }
    if (!text.startsWith(marker, j)) continue
    if (j === from) continue // empty content is not emphasis
    if (isSpace(text[j - 1])) continue
    if (ch === '_' && isWordChar(text[j + width])) continue
    return j
  }
  return -1
}

/** How many of the same delimiter character start at `i`. */
function runLengthAt(text: string, i: number, ch: string): number {
  let run = 0
  while (text[i + run] === ch) run++
  return run
}

/**
 * Tries to read an emphasis span starting at `i`. Returns null to mean "this
 * is just an asterisk", which is the case that has to stay cheap and safe.
 *
 * **The whole run is one delimiter, and a failed match is never retried at a
 * narrower width from the same index.** Retrying let the opener start *inside*
 * the run: `a ** b ** c` failed as bold (the opener is followed by a space),
 * then succeeded as italic opening on the run's *second* asterisk, rendering
 * an italic "* b *". Both tests for that are in markdown.test.ts.
 */
function emphasisAt(text: string, i: number): { node: InlineNode; next: number } | null {
  const ch = text[i]
  if (ch !== '*' && ch !== '_') return null

  const width = Math.min(runLengthAt(text, i, ch), 3)
  const contentStart = i + width
  if (isSpace(text[contentStart])) return null
  // `_` may not open inside a word, for the same reason it may not close
  // inside one.
  if (ch === '_' && isWordChar(text[i - 1])) return null

  const close = findCloser(text, contentStart, ch.repeat(width), ch)
  if (close === -1) return null

  const children = parseInline(text.slice(contentStart, close))
  const node: InlineNode =
    width === 3
      ? { type: 'strong', children: [{ type: 'em', children }] }
      : width === 2
        ? { type: 'strong', children }
        : { type: 'em', children }

  return { node, next: close + width }
}

export function parseInline(text: string): InlineNode[] {
  const out: InlineNode[] = []
  let buf = ''

  const flush = (): void => {
    if (buf) {
      out.push({ type: 'text', value: buf })
      buf = ''
    }
  }

  let i = 0
  while (i < text.length) {
    const ch = text[i]

    if (ch === '\\' && ESCAPABLE.includes(text[i + 1] ?? '')) {
      buf += text[i + 1]
      i += 2
      continue
    }

    // Code first, so an asterisk inside a code span is never read as
    // emphasis — the emphasis scanner never sees those characters at all.
    if (ch === '`') {
      const close = text.indexOf('`', i + 1)
      if (close > i + 1) {
        flush()
        out.push({ type: 'code', value: text.slice(i + 1, close) })
        i = close + 1
        continue
      }
      buf += ch
      i++
      continue
    }

    if (ch === '*' || ch === '_') {
      const emphasis = emphasisAt(text, i)
      if (emphasis) {
        flush()
        out.push(emphasis.node)
        i = emphasis.next
        continue
      }
      // Unmatched: the entire run is literal. Consuming it whole is the other
      // half of the fix described on `emphasisAt` — advancing by one would
      // re-enter the run's second character and open emphasis there.
      const run = runLengthAt(text, i, ch)
      buf += ch.repeat(run)
      i += run
      continue
    }

    buf += ch
    i++
  }

  flush()
  return out
}

const HEADING_RE = /^ {0,3}#{1,6}\s+(.*)$/
const BULLET_RE = /^ {0,3}[-*+]\s+(.*)$/
// Three digits, not nine. `\d{1,9}[.)]` would read the opening of a sentence
// like "2020. Smith reported…" as an ordered list and reformat prose into a
// numbered list. No real list needs to start above 999.
const ORDERED_RE = /^ {0,3}\d{1,3}[.)]\s+(.*)$/

/**
 * Splits text into blocks.
 *
 * Consecutive lines inside one paragraph keep their newline rather than being
 * folded into a space, and `MarkdownText` renders paragraphs with
 * `white-space: pre-wrap`. That is what makes this a safe change: a reply with
 * no markdown in it at all produces exactly one paragraph whose text is the
 * input verbatim, which is byte-for-byte what these surfaces rendered before.
 */
export function parseMarkdown(input: string): Block[] {
  const lines = input.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) })
    paragraph = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.trim() === '') {
      flushParagraph()
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading) {
      flushParagraph()
      blocks.push({ type: 'heading', children: parseInline(heading[1].trim()) })
      continue
    }

    // `*italic*` at the start of a line is not a bullet: both patterns require
    // whitespace after the marker, which emphasis never has.
    const ordered = ORDERED_RE.test(line)
    if (ordered || BULLET_RE.test(line)) {
      flushParagraph()
      const pattern = ordered ? ORDERED_RE : BULLET_RE
      const items: InlineNode[][] = []
      while (i < lines.length) {
        const match = pattern.exec(lines[i])
        if (!match) break
        items.push(parseInline(match[1].trim()))
        i++
      }
      i--
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    paragraph.push(line)
  }

  flushParagraph()
  return blocks
}
