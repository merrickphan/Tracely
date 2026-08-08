# Baseline labels — 2026-08-08

Hand-labelled against `eval/reports/report-2026-08-08T02-37-26-088Z.md`
(commit 4420aef). Labelled by Claude, to be spot-checked by Merrick.

Every change to detection, retrieval or scoring gets re-run against these
three essays and compared to the numbers at the bottom.

Source verdicts:
- **rel** — actually evidence for this specific claim
- **marg** — right topic, doesn't evidence the claim as phrased
- **irr** — not about this claim at all

## Headline

**Detection is not the problem. Retrieval is.**

- Detection precision: **13/13** — every flagged sentence is one a reader
  would expect a citation for. No false positives.
- Detection recall: no checkable assertion was missed across the three
  essays. Opinion sentences ("a transparently weak excuse", "choosing
  logistical convenience") were correctly left alone.
- Retrieval precision: **30/102 strict (29%)**, 48/102 (47%) counting
  marginal. **Roughly half of every evidence list is noise.**

## 01-school-start-times.txt

### AAP 2014 recommendation / majority still start before 8:30 — score 57
citation-worthy: **yes**
- rel: MMWR School Start Times US 2011–12
- marg: Later School Start Time & Improved Sleep · School Start Time Change:
  Where Are We Now? · School Start Time and Sleepy Teens
- irr: Atrial Fibrillation guideline · Life's Essential 8 (AHA) · AASM
  position statement · Congenital Heart Disease guideline
- **1 rel / 8.** Three cardiology guidelines matched on "American …
  Association/College".

### Teens need 8–10 hours, ~70% get under seven — score 66
citation-worthy: **yes**
- rel: Adolescents Living the 24/7 Lifestyle
- marg: Sleep and use of electronic devices in adolescence
- irr: Actigraphy methods · chronotype & depressive symptoms · aerobic
  exercise · 24HMBQ questionnaire · learning modalities · long sleep duration
- **1 rel / 8.** Nothing retrieved reports the prevalence statistic the
  claim actually makes.

### Later start times → more sleep, fewer crashes — score 69
citation-worthy: **yes**
- rel: U Minn Later HS Start Times · Changing Start Times & Teen Motor
  Vehicle Crashes · Adolescent Sleep, Start Times & Crashes · Adolescent
  sleep and later school start times · Start Later, Sleep Later · Start time
  change, sleep duration and car crashes
- marg: Insufficient Sleep in Adolescents · Youthful driving behavior
- **6 rel / 8.** The one genuinely good retrieval in the whole run.

### Sleep debt is the primary driver of the mental health crisis — score 70
citation-worthy: **yes** (and the claim is overreaching, which the critique caught)
- rel: Sleep disruptions & adolescent mental health · Lancet Psychiatry
  Commission · Youth mental health crisis · Smartphones in the Bedroom
- marg: Smartphone addiction Sudan medical students · Why smartphones should
  be silenced
- irr: Sleep Debt Japanese Workers · RAND economic costs
- **4 rel / 8.**

### Depression rates will double within the next decade — score 78
citation-worthy: **borderline** — an unfalsifiable prediction; no source can
support it, which is arguably the most useful thing to tell a student
- rel: none
- marg: Depression in young people (Lancet) · Adolescent anxiety/depression
  before and during Covid
- irr: burden among women of childbearing age · Black LGBTQ+ suicidal
  ideation · AI diagnosis system · social media research · COVID
  co-development · escitalopram monotherapy
- **0 rel / 8, and it scored 78 — the highest in the entire run.**

## 02-remote-work.txt

### Chinese travel agency RCT, 13% more productive — score 39
citation-worthy: **yes**
- rel: The Evolution of Work from Home (JEP)
- marg: two AEA RCT-registry stubs
- irr: Work-Family Conflict · Resilience@Work mindfulness · work incentives ·
  **UAV remote sensing for crop phenotyping** · remote trauma ultrasound
- **1 rel / 8. Bloom et al., "Does Working from Home Work? Evidence from a
  Chinese Experiment" (QJE 2015) — the single paper this claim is about —
  was not retrieved by any of the four providers.**

### Office vacancy rates hit record highs — score 55
citation-worthy: **yes**
- rel: Post-Pandemic Office Market Vacancy · Office Real Estate Apocalypse
  (NBER) · Future of the corporate office
- irr: housing vacancy worldwide · **2020 plasma catalysis roadmap** ·
  police-involved deaths · green office buildings · climate migration
- **3 rel / 8.**

### Remote workers less likely to be promoted — score 38
citation-worthy: **yes**
- rel: none
- marg: In search of the perfect manager?
- irr: **Remote Agent (1998 AI planning)** · supply-chain visibility ·
  **renewable energy remote sensing** · **Lancet Global Eye Health** · data
  justice
- **0 rel / 6. "remote" matched remote sensing and remote agents.**

## 03-printing-press.txt

### Gutenberg c.1450, 200+ cities within fifty years — score 53
citation-worthy: **yes**
- rel: Printing and Europe's Transformation after Gutenberg · Printing and
  Prophecy 1450–1550 · Gutenberg and the Shadow of Bi Sheng
- marg: Manuscripts and Transmission · The Printing Press · Gutenberg,
  chemistry
- irr: **Fabrication of Transistors on Flexible Substrates** · Digital
  Holography of Chinese Movable Type
- **3 rel / 8.**

### Movable type existed in Korea and China first — score 62
citation-worthy: **yes**
- rel: Paper, Printing and the Printing Press · Traditional Korean books and
  bookbinding · Metal Movable-Type Printing · Chinese Gazettes · Non-metal
  Movable-Type Printing
- irr: Tongui-bigan bibliography · Dongyi Baojian editions · **Panax ginseng**
- **5 rel / 8.**

### Reformation depended on pamphlets, so did witch-hunting literature — score 41
citation-worthy: **yes**
- rel: Pamphlets, Propaganda and Witch-Hunting in Germany · English
  Witchcraft Pamphlets
- marg: Witch Belief in the Gàidhealtachd
- irr: five further witch-hunting papers
- **2 rel / 8. Nothing about the Reformation or Luther — the compound query
  retrieved only the witch-hunting half of a two-part claim.**

### Cities adopting printing early grew faster — score 53
citation-worthy: **yes**
- rel: Dittmar, Information Technology and Economic Change (QJE) · Sparking
  Knowledge: Early Technology Adoption
- irr: social interactions · Dauphine small towns · diversity & cities ·
  Hong Kong/Singapore · Industry 4.0 · Chinese federalism
- **2 rel / 8.**

### Alphabet, paper industry, merchant class — score 37
citation-worthy: **yes**
- rel: Book Prices in Early Modern Europe · Paper Stories
- marg: Vavassore Workshop Venice
- irr: Tech Giants and AI journalism · Hebrew Alphabet · 1967
  microdensitometry · **"Does Alphabet spell success for Google?"** ·
  **Consumer and Merchant Adoption of Mobile Payment**
- **2 rel / 8.**

## Numbers to beat

| metric | baseline |
|---|---|
| Detection precision | 13/13 (100%) |
| Detection recall | no misses observed |
| Retrieval precision (strict) | 30/102 — **29%** |
| Retrieval precision (+marginal) | 48/102 — 47% |
| Claims with zero relevant sources | 3/13 |
| Claims with ≥4 relevant sources | 3/13 |
| Score of the worst-retrieved claim | 78/100 |

## What this says about priority

The score is uncorrelated with retrieval quality in the direction that
matters most: the claim with **zero** relevant sources scored **78**, the
highest of all 13, while the claim with six relevant sources scored 69.

Every failure mode below is lexical — a keyword matching the wrong sense of
a word:

- "remote" → remote sensing, remote agents, remote ultrasound
- "Alphabet" → Google's holding company
- "merchant" → mobile payments
- "printing" → transistor lithography
- "American Academy/Association" → cardiology guidelines

That is what an embedding-based relevance signal fixes and what word overlap
structurally cannot. Retrieval, not the stance pass, is the bottleneck.
