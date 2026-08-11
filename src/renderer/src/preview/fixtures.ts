// Realistic stand-in data for the preview harness. Deliberately plausible
// rather than lorem ipsum: the whole point of previewing is to catch things
// like "this venue name wraps to three lines" or "an et-al author list
// overflows the card", and placeholder text hides exactly those.
import type {
  ProfileInfo,
  ScreenWatchClaimSummary,
  ScreenWatchOverlayUpdateEvent,
  ScreenWatchStatus,
  TracerContext
} from '@shared/ipc-contract'
import type {
  Analysis,
  AppSettings,
  AuthUser,
  Citation,
  Claim,
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
  screenWatchAllowedApps: 'WINWORD.EXE\nchrome.exe'
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
    'Screen time causes depression in teenagers. Studies show that 70% of adolescents who use social media for more than three hours a day report symptoms of anxiety. This is the clearest public-health crisis of our generation.',
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
    scoreBreakdown: { sourceCount: 3, quality: 0.8, recency: 0.9, relevance: 0.6, support: 0.1 },
    // Carries markdown on purpose. The relay's prompts neither request nor
    // forbid it and gpt-4.1 emits it freely, so this is what the surface
    // actually receives — keeping it here means the preview exercises
    // MarkdownText rather than a sanitised version of production output.
    critique:
      'The cited work is **cross-sectional**, so it cannot separate "screen time causes depression" from "depressed teenagers use their phones more."\n\nTwo ways forward:\n\n- State the *association* rather than the cause.\n- Find a longitudinal source that measures screen time first.',
    critiqueVerdict: 'weak',
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
    scoreBreakdown: { sourceCount: 2, quality: 0.7, recency: 0.8, relevance: 0.75, support: 0.33 },
    critique: null,
    critiqueVerdict: null,
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
export const documents: DocumentRecord[] = [
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
    updatedAt: T0
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
  rolesFrom: 'heuristic',
  // Matches the `claims` fixture: c1 and c2 searched and sourced, c3 never
  // searched. Kept consistent deliberately — an outline claiming 2 detected
  // beside a list of 3 is the kind of quiet mismatch the preview exists to
  // surface, not to contain.
  coverage: { detected: 3, withRelevantSource: 2, meanStrength: 48, unchecked: 1 },
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

export const tracerConversations: TracerConversation[] = [
  { id: 'tc1', title: 'Why did you flag this claim?', createdAt: T0, updatedAt: T0 },
  { id: 'tc2', title: 'How do I tell if a source is credible?', createdAt: T0, updatedAt: T0 },
  {
    id: 'tc3',
    title: 'What makes my argument about standardized testing weak, exactly?',
    createdAt: T0,
    updatedAt: T0
  }
]

export const tracerMessages: TracerMessage[] = [
  {
    id: 'tm1',
    conversationId: 'tc1',
    role: 'user',
    content: 'Why did you flag this claim, and how would I strengthen it?\n\n"Screen time causes depression in teenagers."',
    createdAt: T0
  },
  {
    id: 'tm2',
    conversationId: 'tc1',
    role: 'tracer',
    content:
      'Because the sentence asserts causation, but the studies usually cited for it are cross-sectional — they measure screen time and mood at the same moment.\n\nAsk yourself: could the arrow point the other way? A teenager who is already depressed may withdraw to their phone. Until your source rules that out, "causes" is doing more work than the evidence supports.\n\nTwo honest fixes: soften the verb ("is associated with"), or find a longitudinal study that measures screen time first and mood later. The Okonkwo 2023 cohort in your evidence list is the second kind — read what it actually concludes before you cite it, though.',
    createdAt: T0
  },
  {
    id: 'tm3',
    conversationId: 'tc1',
    role: 'user',
    content: 'So should I just delete the sentence?',
    createdAt: T0
  },
  {
    id: 'tm4',
    conversationId: 'tc1',
    role: 'tracer',
    // tm2 above is deliberately markdown-free and this one deliberately is not:
    // together they cover both halves of the rendering contract — plain prose
    // must survive verbatim, and markdown must actually render.
    content:
      'That is your call, not mine — but **deleting is usually the weaker move**. The observation underneath the sentence is real and worth keeping; it is only the causal verb that overreaches.\n\nTry this instead:\n\n1. Rewrite it with the weakest verb you can still defend.\n2. Check whether the sentence would survive a reader looking up your source.\n\nNote that `is associated with` is not a hedge — it is a *more precise* claim than "causes", and you can defend it.',
    createdAt: T0
  }
]

export const tracerContext: TracerContext = {
  processName: 'WINWORD.EXE',
  documentText: analysis.sourceText,
  // Not Claim[] — TracerContext carries a trimmed shape (see ipc-contract).
  claims: claims.map((c) => ({
    id: c.id,
    text: c.text,
    claimType: c.claimType,
    evidenceScore: c.strengthScore
  }))
}

export const screenWatchClaims: ScreenWatchClaimSummary[] = [
  {
    id: 'c1',
    text: 'Screen time causes depression in teenagers.',
    claimType: 'causal',
    confidence: 0.93,
    evidence: {
      score: 34,
      count: 6,
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
        }
      ]
    },
    critique: null,
    critiqueVerdict: null,
    citation: null
  },
  {
    id: 'c2',
    text: '70% of adolescents who use social media for more than three hours a day report symptoms of anxiety.',
    claimType: 'statistic',
    confidence: 0.87,
    evidence: { score: 61, count: 4, articles: [] },
    critique: null,
    critiqueVerdict: null,
    citation: null
  },
  {
    id: 'c3',
    text: 'This is the clearest public-health crisis of our generation.',
    claimType: 'opinion',
    confidence: 0.55,
    // null evidence exercises the "search still running" state, which is
    // otherwise only visible for the second or two after detection.
    evidence: null,
    critique: null,
    critiqueVerdict: null,
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

// Underline rects are in overlay-window-local coordinates. The preview
// renders the overlay into a fixed-size frame, so these are chosen to land
// inside it rather than copied from a real screen capture.
export const overlayUpdate: ScreenWatchOverlayUpdateEvent = {
  underlines: [
    { id: 'c1', rects: [{ x: 60, y: 90, width: 280, height: 18 }], claimType: 'causal' },
    {
      id: 'c2',
      rects: [
        { x: 60, y: 120, width: 420, height: 18 },
        { x: 60, y: 142, width: 180, height: 18 }
      ],
      claimType: 'statistic'
    },
    { id: 'c3', rects: [{ x: 60, y: 174, width: 330, height: 18 }], claimType: 'opinion' }
  ],
  widget: {
    rect: { x: 520, y: 300, width: 56, height: 56 },
    expanded: false,
    viewMode: 'single',
    claimCount: screenWatchClaims.length,
    claims: screenWatchClaims,
    totalInfoCount: screenWatchClaims.length + 10
  }
}
