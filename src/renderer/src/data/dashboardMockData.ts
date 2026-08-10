export type DashboardMode = 'evidence' | 'critique'
export type SessionStatus = 'supported' | 'mixed' | 'review'

export interface DashboardSession {
  id: string
  title: string
  sourceText: string
  status: SessionStatus
  dateLabel: string
  mode: DashboardMode
  summary: string
  highlights: string[]
}

export const INITIAL_DASHBOARD_SESSIONS: DashboardSession[] = [
  {
    id: 'sleep-academic-performance',
    title: 'Sleep and academic performance',
    sourceText:
      'Students who consistently sleep at least eight hours perform better academically than students who sleep less.',
    status: 'supported',
    dateLabel: 'Today, 10:32 AM',
    mode: 'evidence',
    summary:
      'The demo result found a broadly supported relationship, while noting that study design and student age can affect the strength of the association.',
    highlights: [
      'Multiple study designs report a positive association.',
      'The exact amount of improvement varies by population.',
      'Causal wording should be tied to longitudinal evidence.'
    ]
  },
  {
    id: 'renewable-energy-costs',
    title: 'Renewable energy costs',
    sourceText: 'Renewable energy is now cheaper than fossil fuels in every country.',
    status: 'mixed',
    dateLabel: 'Yesterday, 4:18 PM',
    mode: 'evidence',
    summary:
      'The demo result found strong evidence for falling generation costs, but the universal wording depends on local financing, storage, and grid conditions.',
    highlights: [
      'Recent cost comparisons favor solar and wind in many markets.',
      'Regional infrastructure changes total system cost.',
      'The phrase “in every country” needs narrower evidence.'
    ]
  },
  {
    id: 'social-media-attention',
    title: 'Social media and attention',
    sourceText: 'Social media has permanently shortened everyone’s attention span.',
    status: 'review',
    dateLabel: 'May 12, 2024, 9:03 AM',
    mode: 'critique',
    summary:
      'The demo critique flags an unsupported universal claim and a causal conclusion that is stronger than the wording of most observational studies.',
    highlights: [
      '“Everyone” makes the claim nearly impossible to support.',
      'Short-term task performance is not the same as permanent change.',
      'The causal mechanism needs to be stated and sourced.'
    ]
  }
]

export function buildDemoSession(
  id: string,
  sourceText: string,
  mode: DashboardMode
): DashboardSession {
  const normalized = sourceText.trim().replace(/\s+/g, ' ')
  const firstSentence = normalized.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? normalized
  const title = firstSentence.length > 58 ? `${firstSentence.slice(0, 55).trimEnd()}…` : firstSentence

  if (mode === 'critique') {
    return {
      id,
      title,
      sourceText: normalized,
      status: 'review',
      dateLabel: 'Just now',
      mode,
      summary:
        'This demo critique illustrates how Tracely would identify wording that needs qualification before a real argument review is connected.',
      highlights: [
        'Check whether the central claim is narrower than the evidence.',
        'Replace absolute language with a measurable statement.',
        'Name the assumptions connecting the evidence to the conclusion.'
      ]
    }
  }

  return {
    id,
    title,
    sourceText: normalized,
    status: 'mixed',
    dateLabel: 'Just now',
    mode,
    summary:
      'This demo result previews how Tracely would organize supporting and conflicting sources when live evidence retrieval is connected.',
    highlights: [
      'The passage contains at least one verifiable factual statement.',
      'Strong evidence should match the population, date, and wording used.',
      'Conflicting or incomplete findings should remain visible to the reader.'
    ]
  }
}
