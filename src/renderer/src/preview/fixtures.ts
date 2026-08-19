// Realistic stand-in data for the preview harness. Deliberately plausible
// rather than lorem ipsum: the whole point of previewing is to catch things
// like "this venue name wraps to three lines" or "an et-al author list
// overflows the card", and placeholder text hides exactly those.
import type {
  ProfileInfo,
  ScreenWatchClaimSummary,
  ScreenWatchOverlayUpdateEvent,
  ScreenWatchStructure,
  ScreenWatchStatus,
} from '@shared/ipc-contract'
import type {
  Analysis,
  AppSettings,
  AuthUser,
  Citation,
  Claim,
  DocumentListItem,
  DocumentOutline,
  DocumentRecord,
  EvidenceItem,
  LibraryItem,
  Source,
  TracerConversation,
  TracerMessage
} from '@shared/types'

// Fixed rather than Date.now() so a screenshot taken today and one taken
// next week are byte-identical — a preview that changes on its own is
// useless for spotting a change you actually made.
export const T0 = '2026-03-14T16:20:00.000Z'

export const user: AuthUser = {
  id: 'u_preview',
  email: 'merrick@example.edu',
  firstName: 'Merrick',
  username: 'merrick'
}

// Local display profile — deliberately separate from `user` above, which is
// the server-verified Supabase identity.
export const profile: ProfileInfo = {
  firstName: 'Merrick',
  lastName: 'Han',
  bio: 'High-school senior building tools for people who have to cite things.',
  avatarUrl: null
}

export const settings: AppSettings = {
  defaultCitationStyle: 'APA',
  hotkeyAccelerator: 'Control+Shift+T',
  enableStrengthSummaries: true,
  theme: 'light',
  accentColor: 'orange',
  density: 'comfortable',
  fontSize: 'medium',
  claimSensitivity: 0.5,
  screenWatchHotkeyAccelerator: 'Control+Shift+W',
  screenWatchAllowedApps: 'WINWORD.EXE\nchrome.exe',
  // Off, so the harness shows the Save changes dialog rather than skipping it.
  suppressSaveConfirm: false,
  gradingLevel: 12
}

export const sources: Source[] = [
  {
    id: 's1',
    doi: '10.1016/j.chb.2023.107891',
    title: 'Adolescent screen time and depressive symptoms: a three-year longitudinal cohort',
    authors: [
      { given: 'Amelia', family: 'Okonkwo' },
      { given: 'Rui', family: 'Zhang' },
      { given: 'Petra', family: 'Lindqvist' },
      { given: 'Daniel', family: 'Ferreira' }
    ],
    year: 2023,
    venue: 'Computers in Human Behavior',
    venueType: 'journal',
    url: 'https://doi.org/10.1016/j.chb.2023.107891',
    pdfUrl: null,
    abstract:
      'Using a three-year longitudinal design (n = 4,218), we find that baseline depressive symptoms predict later screen time more strongly than the reverse, complicating unidirectional causal accounts.',
    provider: 'openalex',
    providerId: 'W4312',
    citationCount: 184,
    oaStatus: 'green',
    createdAt: T0
  },
  {
    id: 's2',
    doi: '10.1073/pnas.2210918120',
    title: 'Reassessing the association between digital media use and adolescent well-being',
    authors: [{ given: 'Sofia', family: 'Marchetti' }, { family: 'Bell' }],
    year: 2022,
    venue: 'Proceedings of the National Academy of Sciences',
    venueType: 'journal',
    url: 'https://doi.org/10.1073/pnas.2210918120',
    pdfUrl: 'https://example.org/pnas.pdf',
    abstract:
      'Specification-curve analysis across three large datasets shows effect sizes small enough to be comparable to the association between well-being and eating potatoes.',
    provider: 'crossref',
    providerId: 'C9931',
    citationCount: 902,
    oaStatus: 'gold',
    createdAt: T0
  },
  {
    id: 's3',
    doi: null,
    title: 'Screen exposure in early adolescence: a preregistered replication',
    authors: [{ given: 'Tomás', family: 'Iglesias-Muñoz' }],
    year: 2024,
    venue: 'PsyArXiv',
    venueType: 'preprint',
    url: 'https://psyarxiv.com/example',
    pdfUrl: null,
    abstract: null,
    provider: 'semanticscholar',
    providerId: 'S771',
    citationCount: 12,
    oaStatus: null,
    createdAt: T0
  }
]

// Deliberately one of each stance, so the preview exercises every badge state
// rather than only the common one: 'supports' and 'contradicts' render a chip,
// null renders nothing. Null is not "neutral" — it means the question was never
// asked, because the source did not clear the relevance bar or the model was
// unavailable.
const STANCES: Array<Pick<EvidenceItem, 'stance' | 'stanceConfidence'>> = [
  { stance: 'supports', stanceConfidence: 0.82 },
  { stance: 'contradicts', stanceConfidence: 0.88 },
  { stance: null, stanceConfidence: null }
]

export const evidence: EvidenceItem[] = sources.map((source, i) => ({
  source,
  relevanceScore: [0.91, 0.78, 0.54][i],
  rank: i + 1,
  ...STANCES[i]
}))

export const analysis: Analysis = {
  id: 'a1',
  sourceText:
    'Screen time causes depression in teenagers. Studies show that 70% of adolescents who use social media for more than three hours a day report symptoms of anxiety. Studies prove that later school start times always improve student outcomes (Wahlstrom 2014). This is the clearest public-health crisis of our generation.',
  origin: 'main',
  createdAt: T0
}

export const claims: Claim[] = [
  {
    id: 'c1',
    analysisId: 'a1',
    text: 'Screen time causes depression in teenagers.',
    claimType: 'causal',
    confidence: 0.93,
    searchQuery: 'screen time adolescent depression causal',
    strengthScore: 34,
    // Low support is what makes this a 34: one source agrees, one disagrees.
    //
    // sourceCount is a FRACTION, not a tally: min(relevant, 6) / 6 in
    // services/search/scoring.ts. Three of the six-source cap cleared the
    // relevance floor, so 3/6 = 0.5. It read `3` until 2026-08-16, which is a
    // value the formula cannot produce — and it was the reason the preview
    // could not show the bug that field caused, since an integer passed off as
    // a source count looks exactly like a source count.
    scoreBreakdown: { sourceCount: 0.5, quality: 0.8, recency: 0.9, relevance: 0.6, support: 0.1 },
    // Carries markdown on purpose. The relay's prompts neither request nor
    // forbid it and gpt-4.1 emits it freely, so this is what the surface
    // actually receives — keeping it here means the preview exercises
    // MarkdownText rather than a sanitised version of production output.
    critique:
      'The cited work is **cross-sectional**, so it cannot separate "screen time causes depression" from "depressed teenagers use their phones more."\n\nTwo ways forward:\n\n- State the *association* rather than the cause.\n- Find a longitudinal source that measures screen time first.',
    critiqueVerdict: 'weak',
    // Null on purpose, and not an oversight: the relay sets suggestedRevision
    // for overstatement and for nothing else — "softening a false claim into a
    // vague one is not a fix" — so a 'weak' verdict is the case where the fix
    // card has no replacement text to offer and falls back to the critique's
    // own points. That is the branch this claim exercises.
    suggestedRevision: null,
    citationFix: null,
    createdAt: T0
  },
  {
    id: 'c2',
    analysisId: 'a1',
    text: '70% of adolescents who use social media for more than three hours a day report symptoms of anxiety.',
    claimType: 'statistic',
    confidence: 0.87,
    searchQuery: 'adolescents social media three hours anxiety prevalence',
    strengthScore: 61,
    // 2 of the 6-source cap on topic: 2/6 = 0.333…
    scoreBreakdown: { sourceCount: 1 / 3, quality: 0.7, recency: 0.8, relevance: 0.75, support: 0.33 },
    critique: null,
    critiqueVerdict: null,
    suggestedRevision: null,
    citationFix: null,
    createdAt: T0
  },
  // The editor's counterpart to the overlay's c4 — an 'overstated' verdict with
  // a narrowed sentence attached, which is the only state where the fix card
  // has something to APPLY. Mirrors the Screen Watch fixture deliberately: the
  // two surfaces draw the same card from the same claim state, and a difference
  // between them should be visible side by side in the harness.
  {
    id: 'c4',
    analysisId: 'a1',
    text: 'Studies prove that later school start times always improve student outcomes (Wahlstrom 2014).',
    claimType: 'causal',
    confidence: 0.81,
    searchQuery: 'later school start times student outcomes',
    strengthScore: 68,
    scoreBreakdown: { sourceCount: 0.9, quality: 0.81, recency: 0.6, relevance: 0.74, support: 0.66 },
    critique:
      '**Overstated, not wrong.** Evidence 2 and 4 report improved attendance and sleep duration, but neither supports "always" — both note effects varying by district and grade level.',
    critiqueVerdict: 'overstated',
    suggestedRevision:
      'Studies indicate that later school start times generally improve student outcomes (Wahlstrom 2014).',
    citationFix:
      'Wahlstrom, Kyla. "Later Start Time for Teens Improves Grades, Mood, and Safety." Phi Delta Kappan, 2014, p. 12.',
    createdAt: T0
  },
  {
    id: 'c3',
    analysisId: 'a1',
    text: 'This is the clearest public-health crisis of our generation.',
    claimType: 'opinion',
    confidence: 0.55,
    searchQuery: 'public health crisis generation screen time',
    strengthScore: null,
    scoreBreakdown: null,
    critique: null,
    critiqueVerdict: null,
    suggestedRevision: null,
    citationFix: null,
    createdAt: T0
  }
]

export const citations: Citation[] = [
  {
    id: 'cite1',
    sourceId: 's1',
    style: 'APA',
    formattedText:
      'Okonkwo, A., Zhang, R., Lindqvist, P., et al. (2023). Adolescent screen time and depressive symptoms: a three-year longitudinal cohort. Computers in Human Behavior.',
    createdAt: T0
  }
]

export const libraryItems: LibraryItem[] = [
  {
    id: 'l1',
    sourceId: 's1',
    claimId: 'c1',
    notes: 'Best longitudinal counter-example to the causal framing.',
    tags: ['screen-time', 'longitudinal'],
    savedAt: T0,
    source: sources[0]
  },
  {
    id: 'l2',
    sourceId: 's2',
    claimId: null,
    notes: null,
    tags: [],
    savedAt: T0,
    source: sources[1]
  }
]

// One saved document, so the editor's reopen-where-you-left-off path has
// something to reopen in the preview.
// Six paragraphs rather than two, because the Structure panel renders one row
// per paragraph and a two-paragraph document exercises none of what makes that
// list hard: an unlabelled paragraph, a warrant gap, and enough rows to scroll.
// Typed DocumentListItem, so the Documents page (58:172) has a grid to draw.
// The grades are the point of the extra entries: the card's chip changes colour
// across bands, and one document is deliberately UNGRADED — the state a draft
// is in before anything has read it, which is what a new user sees on every
// card and so the one worth being able to look at.
export const documents: DocumentListItem[] = [
  {
    id: 'doc-1',
    title: 'Screen time essay — draft 2',
    bodyHtml:
      '<div>Screen time causes depression in teenagers.</div><div><br></div>' +
      '<div>Studies show that <b>70%</b> of adolescents who use social media for more than three hours a day report symptoms of anxiety.</div><div><br></div>' +
      '<div>Longitudinal data from Norway tracked 2,000 students over four years. The effect persisted after controlling for baseline mental health, which suggests the relationship is not merely correlational.</div><div><br></div>' +
      '<div>Schools in three districts have already moved to ban phones during instructional hours.</div><div><br></div>' +
      '<div>This matters because policy is being written now, before the evidence has settled.</div><div><br></div>' +
      '<div>In conclusion, the link is real but weaker than the debate assumes.</div>',
    createdAt: T0,
    updatedAt: T0,
    // Hand-traced below with the outline: 20 + 10 + 0 + 0 + 15 + 10 = 55, which
    // gradeFor bands as a C. Written as a literal so a change to scoreDraft
    // shows up as a disagreement with that trace rather than following it.
    score: 55,
    gradedAt: T0
  },
  {
    id: 'doc-2',
    title: 'The Cold War Redefined',
    bodyHtml: '<div>A second saved draft, listed but not opened in the preview.</div>',
    createdAt: T0,
    updatedAt: T0,
    // 82 is the score the Figma grade card is drawn around, and gradeFor bands
    // it B+ — so this entry is also the check that the chip and the grade panel
    // agree on one number.
    score: 82,
    gradedAt: T0
  },
  {
    id: 'doc-3',
    title: 'Macbeth Character Analysis',
    bodyHtml: '<div>A third saved draft.</div>',
    createdAt: T0,
    updatedAt: T0,
    score: 91,
    gradedAt: T0
  },
  {
    id: 'doc-4',
    title: 'Untitled document',
    bodyHtml: '<div>Written but never analysed.</div>',
    createdAt: T0,
    updatedAt: T0,
    // The ungraded state, and not an error: no chip, and the card says so
    // rather than showing a letter nothing computed.
    score: null,
    gradedAt: null
  }
]

// What the LOCAL heuristics actually produce for the document above — not an
// idealised outline. The heuristics can only emit thesis / claim /
// counterargument / significance / conclusion / unknown, so paragraphs 3 and 4
// come back unlabelled, `complete` is false, and the panel must show
// "provisional". Faking a fully-labelled outline here would hide the exact
// state most users see before the classifier ships.
//
// Score traces by hand: thesis 20 + governing claims 10 (1 of 2 expected in a
// 4-paragraph body) + warrant 0 (the one paragraph owing a warrant has none)
// + counterargument 0 + significance 15 + conclusion 10 = 55.
export const documentOutline: DocumentOutline = {
  documentId: 'doc-1',
  analysisId: 'a1',
  sourceHash: 'preview-hash-draft-2',
  schemaVersion: 1,
  paragraphs: [
    { index: 1, role: 'thesis', hasWarrant: false, claimIds: ['c1'] },
    { index: 2, role: 'claim', hasWarrant: false, claimIds: ['c2'] },
    { index: 3, role: 'unknown', hasWarrant: true, claimIds: [] },
    { index: 4, role: 'unknown', hasWarrant: false, claimIds: [] },
    { index: 5, role: 'significance', hasWarrant: false, claimIds: [] },
    { index: 6, role: 'conclusion', hasWarrant: false, claimIds: [] }
  ],
  score: 55,
  components: {
    thesis: 20,
    governingClaims: 10,
    warrant: 0,
    counterargument: 0,
    significance: 15,
    conclusion: 10
  },
  complete: false,
  applicable: true,
  rolesFrom: 'heuristic',
  // Six paragraphs, so five boundaries, one of which is flagged. A real value
  // rather than the `null` the type also allows: null is what a row written
  // before cohesion existed restores as, and a fixture standing in for that
  // would leave the harness with no way to look at the feature at all.
  cohesion: {
    score: 72,
    boundaries: 5,
    findings: [
      {
        kind: 'no-transition',
        fromIndex: 2,
        toIndex: 3,
        message: 'Paragraph 3 opens without connecting back to the point paragraph 2 made.'
      }
    ]
  },
  // Matches the `claims` fixture: c1 and c2 searched and sourced, c3 never
  // searched. Kept consistent deliberately — an outline claiming 2 detected
  // beside a list of 3 is the kind of quiet mismatch the preview exists to
  // surface, not to contain.
  // `outsideIndexes: 0` — none of these three claims trips retrievalScopeFor,
  // so the report's sub-line reads exactly as it did before that field existed
  // and this fixture covers the unchanged path.
  coverage: {
    detected: 3,
    withRelevantSource: 2,
    withOwnCitation: 1,
    meanStrength: 48,
    unchecked: 1,
    outsideIndexes: 0
  },
  weaknesses: [
    {
      kind: 'warrant-gap',
      paragraphIndex: 2,
      claimId: 'c2',
      message:
        'The 2nd paragraph presents a claim without explaining how it supports the argument.',
      tracerPrompt:
        'In my 2nd paragraph, how do I explain what my evidence actually shows without just restating it?'
    }
  ],
  analyzedAt: T0
}

// The same document as the relay classifier would label it: every paragraph
// resolved, so the panel drops the "provisional" badge and whole-draft
// weaknesses become sayable. Selected by the "classified" preview scenario —
// without it the confident state is unreachable with no relay running.
export const documentOutlineClassified: DocumentOutline = {
  ...documentOutline,
  paragraphs: [
    { index: 1, role: 'thesis', hasWarrant: false, claimIds: ['c1'] },
    { index: 2, role: 'evidence', hasWarrant: false, claimIds: ['c2'] },
    { index: 3, role: 'evidence', hasWarrant: true, claimIds: [] },
    { index: 4, role: 'transition', hasWarrant: false, claimIds: [] },
    { index: 5, role: 'significance', hasWarrant: false, claimIds: [] },
    { index: 6, role: 'conclusion', hasWarrant: false, claimIds: [] }
  ],
  score: 60,
  components: {
    thesis: 20,
    governingClaims: 0,
    warrant: 10,
    counterargument: 0,
    significance: 15,
    conclusion: 10
  },
  complete: true,
  applicable: true,
  rolesFrom: 'model',
  weaknesses: [
    {
      kind: 'warrant-gap',
      paragraphIndex: 2,
      claimId: 'c2',
      message:
        'The 2nd paragraph presents evidence without explaining how it supports the argument.',
      tracerPrompt:
        'In my 2nd paragraph, how do I explain what my evidence actually shows without just restating it?'
    },
    {
      kind: 'evidence-stacking',
      paragraphIndex: 3,
      claimId: null,
      message:
        'The 3rd paragraph adds more evidence to the 2nd without a claim between them. Stacked sources read as a literature review rather than an argument.',
      tracerPrompt: 'My 3rd and 2nd paragraphs are both evidence. What claim should be joining them?'
    },
    {
      kind: 'no-counterargument',
      paragraphIndex: null,
      claimId: null,
      message:
        'Nothing in this draft engages an opposing view. An argument that never meets resistance reads as one that has not been tested.',
      tracerPrompt: 'What is the strongest objection to my argument, and how do I address it fairly?'
    }
  ]
}

export const screenWatchClaims: ScreenWatchClaimSummary[] = [
  {
    id: 'c1',
    text: 'Screen time causes depression in teenagers.',
    claimType: 'causal',
    confidence: 0.93,
    hasInlineCitation: false,
    problemKinds: ['weak-reasoning', 'partial-evidence'],
    evidence: {
      score: 34,
      count: 6,
      // Hand-traced against WEIGHTS_WITHOUT_STANCE in search/scoring.ts:
      // .3(.42) + .25(.5) + .3(.31) + .15(.2) = .126 + .125 + .093 + .03 = .374
      // -> 37, close enough to the fixture's 34 to read as the same claim.
      breakdown: { sourceCount: 0.5, quality: 0.31, recency: 0.2, relevance: 0.42, support: 0 },
      articles: [
        {
          title: 'Adolescent screen time and depressive symptoms: a three-year longitudinal cohort',
          venue: 'Computers in Human Behavior',
          year: 2023,
          provider: 'openalex',
          url: 'https://doi.org/10.1016/j.chb.2023.107891',
          faviconDataUrl: null
        },
        {
          title: 'Reassessing the association between digital media use and adolescent well-being',
          venue: 'PNAS',
          year: 2022,
          provider: 'crossref',
          url: 'https://doi.org/10.1073/pnas.2210918120',
          faviconDataUrl: null
        },
        {
          title: 'Displacement or distress? Two accounts of adolescent smartphone use',
          venue: 'Journal of Adolescence',
          year: 2021,
          provider: 'semanticscholar',
          url: 'https://doi.org/10.1016/j.adolescence.2021.04.006',
          faviconDataUrl: null
        }
      ]
    },
    // A verdict and its prose, together. This carried `problemKinds:
    // ['weak-reasoning']` with a NULL critique — a pair main cannot produce
    // (problemKindsFor only reaches 'weak-reasoning' from a critiqueVerdict, and
    // screenWatchService writes the two in one step), so the harness showed the
    // popover's no-critique fallback sentence and the fix card had nothing at
    // all to open onto. Same class of fixture bug as the one c3's comment
    // records. The markdown is deliberate: it is what the relay actually emits,
    // and it is what critiqueIssues splits into the card's rows.
    critique:
      'The cited work is **cross-sectional**, so it cannot separate "screen time causes depression" from "depressed teenagers use their phones more."\n\n- State the *association* rather than the cause.\n- Find a longitudinal source that measures screen time first.',
    critiqueVerdict: 'weak',
    // Null, as the relay leaves it for every verdict but 'overstated' — so this
    // claim is the fix card's no-revision branch, and c4 below is its other one.
    suggestedRevision: null,
    citationFix: null,
    citation: null
  },
  {
    id: 'c2',
    text: '70% of adolescents who use social media for more than three hours a day report symptoms of anxiety.',
    claimType: 'statistic',
    confidence: 0.87,
    hasInlineCitation: false,
    problemKinds: ['unverified-statistic'],
    evidence: {
      score: 61,
      count: 4,
      breakdown: { sourceCount: 0.83, quality: 0.72, recency: 0.55, relevance: 0.38, support: 0 },
      articles: []
    },
    critique: null,
    critiqueVerdict: null,
    suggestedRevision: null,
    citationFix: null,
    citation: null
  },
  // The only fixture with a critique already on it, and the only one that
  // exercises CritiqueFixRow. Both fix fields are populated together because
  // the two blocks stack, and stacked is the layout most likely to overflow the
  // fixed-height panel — the state worth being able to look at.
  //
  // A deliberately mild overstatement: "100%" is the textbook case and would
  // make the feature look easier than it is. The interesting claim is one where
  // the substance is right and a single quantifier is doing the damage.
  {
    id: 'c4',
    text: 'Studies prove that later school start times always improve student outcomes (Wahlstrom 2014).',
    claimType: 'causal',
    confidence: 0.81,
    hasInlineCitation: true,
    problemKinds: ['overstated-claim'],
    evidence: {
      score: 68,
      count: 6,
      breakdown: { sourceCount: 0.9, quality: 0.81, recency: 0.6, relevance: 0.74, support: 0.66 },
      articles: []
    },
    critique:
      '**Overstated, not wrong.** Evidence 2 and 4 report improved attendance and sleep duration, but neither supports "always" — both note effects varying by district and grade level. **Citation format.** The reference is MLA author-page with the year in the page slot; in MLA it takes a page number, not 2014.',
    critiqueVerdict: 'overstated',
    suggestedRevision:
      'Studies indicate that later school start times generally improve student outcomes (Wahlstrom 2014).',
    citationFix: 'Wahlstrom, Kyla. "Later Start Time for Teens Improves Grades, Mood, and Safety." Phi Delta Kappan, 2014, p. 12.',
    citation: null
  },
  {
    id: 'c3',
    text: 'This is the clearest public-health crisis of our generation.',
    claimType: 'opinion',
    confidence: 0.55,
    hasInlineCitation: false,
    // 'searching', not 'missing-citation'. The pair below is what main
    // produces for an unresolved claim — problemKindsFor answers a null
    // `evidence` with exactly ['searching'] — and the two have to agree,
    // because every card downstream reads the KIND and trusts that a
    // non-'searching' one came with evidence attached. Named
    // 'missing-citation' beside a null evidence, this fixture pushed a payload
    // main cannot produce and crashed ProblemCard on `evidence.breakdown`,
    // which is the harness inventing a bug rather than finding one.
    problemKinds: ['searching'],
    // null evidence exercises the "search still running" state, which is
    // otherwise only visible for the second or two after detection.
    evidence: null,
    critique: null,
    critiqueVerdict: null,
    suggestedRevision: null,
    citationFix: null,
    citation: null
  }
]

export const screenWatchStatus: ScreenWatchStatus = {
  enabled: true,
  active: true,
  processName: 'WINWORD.EXE',
  supportsUnderlines: true,
  claimCount: screenWatchClaims.length,
  lastError: null,
  authRequired: false,
  blockedApp: null
}

/**
 * The structural read Screen Watch computes over the watched document.
 *
 * Score traced by hand against scoreDraft's rubric, so a change to the formula
 * shows up here as a disagreement rather than as a fixture quietly following it:
 *
 *   thesis            20/20  role 'thesis' at index 0
 *   governing claims  20/20  body = slice(1,-1) = 4 paragraphs, 2 carry role
 *                            'claim', expected = ceil(4 * 0.5) = 2, so 2/2
 *   warrant           13/20  owed by 'claim'|'evidence' = paragraphs 2, 3, 4;
 *                            2 of 3 have a connective -> 20 * 2/3
 *   counterargument   15/15  paragraph 5
 *   significance       0/15  no significance paragraph, no so-what in the
 *                            conclusion — which is why 'no-significance' is
 *                            in the weakness list below
 *   conclusion        10/10  role 'conclusion' in last position
 *                    ------
 *                    78/100
 *
 * `complete: true` (no 'unknown' role), so the whole-draft weaknesses are
 * allowed to fire. Set a role to 'unknown' to exercise the Provisional badge
 * and watch 'no-significance' correctly disappear.
 */
export const screenWatchStructure: ScreenWatchStructure = {
  score: 78,
  complete: true,
  components: {
    thesis: 20,
    governingClaims: 20,
    warrant: 13.333333333333332,
    counterargument: 15,
    significance: 0,
    conclusion: 10
  },
  // Matches screenWatchClaims: c1 (34) and c2 (61) found sources, c3 searched
  // and found nothing — which is what makes it an 'unsupported-claim' rather
  // than an unchecked one.
  // `outsideIndexes: 1` — c3 is the searched-and-empty claim, and it is the one
  // the academic indexes were never going to hold.
  //
  // The overlay renders ArgumentScoreModal in `compact` mode, which draws no
  // claim-count lines at all (370:135 is a ring, an eyebrow, a grade and one
  // line), so nothing here reads this field today. It is set anyway, and set
  // to the value that is TRUE of these three claims: a fixture that quietly
  // omits a field is a fixture that stops matching the payload, which is the
  // one thing it exists not to do. `searchableClaims(3, 1, 2)` = 2 is the
  // number the non-compact report would print, and it is unit-tested in
  // shared/coverageCounts.test.ts rather than asserted from a render.
  coverage: {
    detected: 3,
    withRelevantSource: 2,
    withOwnCitation: 1,
    meanStrength: 42,
    unchecked: 0,
    outsideIndexes: 1
  },
  // A believable school essay rather than round numbers: 1,240 words over 71
  // sentences is ~17.5 words per sentence and ~5 minutes to read, which is what
  // the stats row should show. Round figures here would hide an arithmetic
  // mistake in the panel by making every cell look plausible.
  stats: { words: 1240, sentences: 71, uniqueWords: 521 },
  weaknesses: [
    {
      kind: 'unsupported-claim',
      paragraphIndex: 6,
      claimId: 'c3',
      message: 'The claim in the 6th paragraph has no supporting source yet.',
      tracerPrompt:
        'Tracely could not find evidence for one of my claims. How should I go about checking it?'
    },
    {
      kind: 'warrant-gap',
      paragraphIndex: 3,
      claimId: null,
      message:
        'The 3rd paragraph presents evidence without explaining how it supports the argument.',
      tracerPrompt:
        'In my 3rd paragraph, how do I explain what my evidence actually shows without just restating it?'
    },
    {
      kind: 'new-claim-in-conclusion',
      paragraphIndex: 6,
      claimId: 'c3',
      message:
        'The conclusion introduces a new claim. Anything asserted here has no room left to be supported.',
      tracerPrompt: 'My conclusion makes a new claim. Where should that argument go instead?'
    },
    {
      // paragraphIndex null — the case the overlay must render as a plain
      // "Draft" chip rather than a jump target.
      kind: 'no-significance',
      paragraphIndex: null,
      claimId: null,
      message:
        'The draft never says why this matters. A reader finishes knowing what is true but not what follows from it.',
      tracerPrompt:
        'My essay proves its point but never says why it matters. How do I write that without overclaiming?'
    }
  ],
  paragraphs: [
    { index: 1, role: 'thesis', hasWarrant: false, claimIds: [] },
    { index: 2, role: 'claim', hasWarrant: true, claimIds: ['c1'] },
    // The one paragraph owed a warrant that has none — the warrant-gap above.
    { index: 3, role: 'evidence', hasWarrant: false, claimIds: [] },
    { index: 4, role: 'claim', hasWarrant: true, claimIds: ['c2'] },
    { index: 5, role: 'counterargument', hasWarrant: true, claimIds: [] },
    { index: 6, role: 'conclusion', hasWarrant: true, claimIds: ['c3'] }
  ],
  previews: [
    'Schools should delay their start times, because the sleep teenagers lose to an early bell…',
    'Screen time causes depression in teenagers. Adolescents who spend longer on their phones…',
    'Twenge and Campbell (2018) found a dose-response relationship. Orben and Przybylski (2019)…',
    '70% of adolescents who use social media for more than three hours a day report symptoms…',
    'Some researchers argue the effect sizes here are trivially small, and that is fair — the…',
    'In conclusion, schools must act. Districts that moved to a later bell saw graduation rates…'
  ]
}

// Underline rects are in overlay-window-local coordinates. The preview
// renders the overlay into a fixed-size frame, so these are chosen to land
// inside it rather than copied from a real screen capture.
/**
 * What "Refresh Evidence" lands: the same three sources plus one the previous
 * search missed, so the panel's "Updated just now" chip and its "New" row have
 * something real to mark. Deliberately a genuine superset — the card decides
 * which rows are new by diffing against the pre-refresh set, and a fixture that
 * simply replaced the list would light every row up.
 */
export const screenWatchEvidenceRefreshed: ScreenWatchClaimSummary['evidence'] = {
  score: 41,
  count: 9,
  breakdown: { sourceCount: 0.75, quality: 0.38, recency: 0.44, relevance: 0.42, support: 0 },
  articles: [
    {
      title: 'Longitudinal evidence on smartphone use and adolescent mood: a 2024 replication',
      venue: 'Nature Human Behaviour',
      year: 2024,
      provider: 'openalex',
      url: 'https://doi.org/10.1038/s41562-024-01822-x',
      faviconDataUrl: null
    },
    ...screenWatchClaims[0].evidence!.articles
  ]
}

/**
 * A critique in the shape the relay actually returns — one paragraph under 120
 * words, not a bulleted list. The panel's critique view has to read this back
 * into the design's issue rows, so the fixture must be the awkward case rather
 * than a tidy list that would make the parser look better than it is.
 */
export const screenWatchCritique =
  'The claim asserts causation from evidence that is largely cross-sectional. Evidence 2 measures screen time and mood at the same moment, so it cannot establish which came first — a withdrawn teenager may reach for a phone rather than the other way round.\n\nIt also generalises from adolescents in high-income countries to "teenagers" without qualification. Narrow the population, or soften "causes" to "is associated with", which evidence 1 does support.'

export const overlayUpdate: ScreenWatchOverlayUpdateEvent = {
  underlines: [
    { id: 'c1', rects: [{ x: 60, y: 90, width: 280, height: 18 }], claimType: 'causal', problemKinds: ['weak-reasoning', 'partial-evidence'] },
    {
      id: 'c2',
      rects: [
        { x: 60, y: 120, width: 420, height: 18 },
        { x: 60, y: 142, width: 180, height: 18 }
      ],
      claimType: 'statistic',
      problemKinds: ['unverified-statistic']
    },
    { id: 'c3', rects: [{ x: 60, y: 174, width: 330, height: 18 }], claimType: 'opinion', problemKinds: ['missing-citation'] }
  ],
  widget: {
    rect: { x: 520, y: 300, width: 56, height: 56 },
    expanded: false,
    viewMode: 'single',
    claimCount: screenWatchClaims.length,
    claims: screenWatchClaims,
    totalInfoCount: screenWatchClaims.length + 10,
    // Hand-traced, not derived: the `underlines` array above carries three
    // entries (c1, c2, c3). Written as a literal so adding a fourth shows up
    // here as a disagreement instead of quietly following along — which is the
    // whole point of the badge counting marks rather than claims or sources.
    underlineCount: 3,
    structure: screenWatchStructure,
    // False alongside a non-null `structure`, because those are the only two
    // states main ever pushes together — see ScreenWatchWidget.analyzing. The
    // rail's Screen Watch scenario flips this (and drops the structure) to
    // reach the Analyzing card, which is otherwise only visible during the
    // second or two before a real draft's first reading lands.
    analyzing: false
  }
}

/**
 * Tracer's opening exchange, so the panel has something in it on first render.
 *
 * Written against `documents[0]` — a conversation that names a draft the
 * harness does not list would be a small lie that reviewers chase.
 */
export const tracerConversation: TracerConversation = {
  id: 'preview-conversation',
  title: 'Renewable Energy Argument',
  createdAt: T0,
  updatedAt: T0
}

export const tracerMessages: TracerMessage[] = [
  {
    id: 'preview-msg-1',
    conversationId: tracerConversation.id,
    role: 'tracer',
    content:
      'Hey! I can see your most recent draft. Ask me about a claim, a paragraph that is not landing, or what the grade is reacting to.',
    createdAt: T0
  }
]

/** The draft text Tracer says it can see, for the context line. */
export const documentText =
  'Fossil fuel companies are the root of all environmental degradation. Renewable energy is cheaper per kilowatt-hour than coal in most markets.'
