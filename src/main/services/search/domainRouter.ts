import { cosineSimilarity, embedCached } from '../ml'

// PubMed indexes biomedical literature and nothing else. For a claim about the
// printing press, every result it can possibly return is a false match — so
// the baseline's 0 relevant sources out of 11 was structural, not bad luck.
//
// The naive fix is to route by claim type or by essay topic. Neither works:
// the labelled set contains a sleep-and-adolescent-depression claim that
// PubMed answers well, and a "randomized controlled trial at a Chinese travel
// agency" claim that reads medical, is about remote work, and returns 1057
// cardiology papers. The decision has to be per claim and has to be about
// meaning, not vocabulary.
//
// A keyword list fails for the same reason: the words that decide these cases
// — sleep, school, trial, crash — are not themselves medical.

const BIOMEDICAL_ANCHORS = [
  'a clinical study of human health, disease, medicine, or physiology',
  'research on sleep, nutrition, mental health, or the human body',
  'a medical trial measuring a health outcome in patients'
]

const OTHER_ANCHORS = [
  'a study in history, economics, technology, or the social sciences',
  'research about business, labour markets, culture, or public policy',
  'a historical account of an invention and its consequences'
]

// How far ahead the biomedical anchors must be before PubMed is worth three
// requests and a share of the eight evidence slots.
//
// Zero would be the natural cut, and 0.03 exists for one measured case: the
// travel-agency RCT clears zero by 0.011 and is exactly the claim PubMed
// handles worst. This is a threshold from thirteen claims, not a calibration
// — it should move when the full eval can run.
const BIOMEDICAL_MARGIN = 0.03

/**
 * Whether PubMed is worth querying for this claim.
 *
 * Falls to `false` when embeddings are unavailable. That is the deliberate
 * direction: PubMed contributed zero relevant sources across the labelled
 * baseline while costing three requests per claim, so a machine that cannot
 * run the router loses nothing measurable by skipping it — whereas defaulting
 * to `true` would reinstate the noise for exactly the low-end users least able
 * to afford the latency.
 */
export async function shouldQueryPubmed(claimText: string, searchQuery: string): Promise<boolean> {
  const subject = `${claimText} ${searchQuery}`.trim()
  const vectors = await embedCached([...BIOMEDICAL_ANCHORS, ...OTHER_ANCHORS, subject])
  if (!vectors) return false

  const subjectVector = vectors[vectors.length - 1]
  const scores = vectors.slice(0, -1).map((anchor) => cosineSimilarity(anchor, subjectVector))

  // Max over anchors rather than a centroid: the domains are broad, and one
  // anchor matching strongly is the signal. Averaging lets two unrelated
  // anchors dilute a clear hit on the third.
  const biomedical = Math.max(...scores.slice(0, BIOMEDICAL_ANCHORS.length))
  const other = Math.max(...scores.slice(BIOMEDICAL_ANCHORS.length))

  return biomedical - other > BIOMEDICAL_MARGIN
}
