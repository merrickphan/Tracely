import { describe, it } from 'node:test'
import { heuristicRoles, hasClosingSignificance, hasWarrantMarker } from './roles.ts'
import { scoreDraft } from './scoreDraft.ts'

/**
 * Throwaway probe: runs one real essay through the real scorer.
 *
 * Asserts nothing. It exists to print the role vector and component breakdown
 * for a draft that scored 20/100 in the app, so the number can be explained
 * rather than guessed at. Delete after reading.
 */

const PARAGRAPHS = [
  // 1 — intro; the thesis is the LAST sentence.
  '"I was born with an enormous need for affection and a terrible need to give it" ("Actress"). Audrey Hepburn was born to an English father and a Dutch mother in Brussels, Belgium, on May 4th, 1929. For a portion of her childhood, she was satisfied, happy, and healthy, until WWII. Hepburn was greatly affected by the prejudice against Jewish people, or antisemitism, that surrounded her. Audrey Hepburn\'s dreams were ruined by several traumatic and lasting events due to the effects of the cataclysm of the early-mid 20th century, which would later have a large impact on her future life events and career. Raised by Nazi sympathizers, Audrey strongly opposed the views of her parents and went against them by aiding the Dutch resistance in various ways, so even in her early life, she was morally inclined to help others in their own struggles. After WWII impacted her physical health, her dreams of becoming a professional dancer were shattered, so she started playing small roles until she found herself becoming increasingly popular on screen. Her career in film was a coincidental stroke of serendipity that caused her influence and name to be more widespread. Rather than use her popularity for personal good, Hepburn used her name as a tool to bring awareness towards people in need by working with UNICEF. Whilst helping others is typically a moral obligation, Audrey Hepburn\'s early struggles sparked a passion to help others in dire situations which set her apart from celebrities in her time.',
  // 2 — body: resistance work.
  'Audrey Hepburn was always naturally inclined to help others. Although her concern for the well-being of humanity was greatly motivated by her sympathy towards those in troublesome situations, her good deeds sprouted from the natural kindness she was born with. Hepburn had started working against the Nazi party shortly after an event in 1942 where "her uncle, Otto van Limburger Stirim, was executed in retaliation for an act of sabotage by the resistance movement, [and] while he had not been involved in the act, he was targeted due to his family\'s prominence in Dutch society" ("Audrey" Wikipedia). Following the death of her uncle, Hepburn raised money for the Dutch Resistance via silent dance performances. She had largely contributed to the resistance by participating in "underground" activities such as delivering newspapers and "taking messages and food to downed Allied flyers". She also volunteered in a hospital that was involved with resistance activity. Knowing and experiencing the pain that others had to suffer through, she did what she could to help bring others relief in uneasy times. This period was tough for everyone, but Hepburn gave what she could and put others before herself which underlines her genuine concern for other people.',
  // 3 — body: starvation, UNICEF.
  'Audrey Hepburn was a prominent individual in an industry of prominent people, but she stood out not only because of her talent and compassion in her work but because of her compassion for people. Shortly after D-Day, living conditions in Arnhem became extreme, and people in the Netherlands struggled to survive, Hepburn, being one of them. This was caused by the Nazis who wanted to kill the population by starving them to death. She devolved anemia, respiratory difficulties, and oedema because of her consequential malnutrition, which prevented her from becoming a full-time dancer. Surviving on boiled grass and tulip bulbs, the people of Arnhem who were inches from death received medical help from UNICEF, hence her "long-lasting gratitude for what UNICEF does" ("Audrey" UNICEF). Rather than be swallowed by pride and self-worth, Hepburn remembered where she came from. By remembering the days where she herself was struggling to survive, she was down to earth and kept humble even throughout her career. A catapult crafted from her fame, fortune, and beauty, Hepburn\'s comforts and advantages at the peak of her life were used to help others and "devoted much of her time to UNICEF, to which she had contributed since 1954" ("Audrey" Wikipedia). Her selfless acts of dedication distinguished her from not her work in film, but her work in humanitarianism displayed a different side of her portraying a normal human being with good natures rather than some on-screen phenomenon.',
  // 4 — conclusion.
  '"As you grow older, you will discover that you have two hands, one for helping yourself, the other for helping others". Iconic in Hollywood, but overlooked in philanthropy, Audrey Hepburn was set apart from celebrities because of her sincere love for people and their well-being. The legacy she left behind tends to reside in the film industry, but she was more than just a pretty face. In her final years, she spent her time working towards bringing basic necessities, education, comfort, and love to underprivileged people. Audrey Hepburn\'s life came to an end on January 20th, 1993, her name still lives on with the Audrey Hepburn Memorial Fund at UNICEF to continue her humanitarian work.'
]

function spans() {
  return PARAGRAPHS.map((text, i) => ({ index: i + 1, start: 0, end: text.length, text }))
}

describe('PROBE — the Hepburn essay', () => {
  it('prints the role vector and score for several claim distributions', () => {
    console.log('\n--- per-paragraph markers ---')
    PARAGRAPHS.forEach((text, i) => {
      console.log(
        `  P${i + 1}: warrant=${String(hasWarrantMarker(text)).padEnd(5)} significance=${hasClosingSignificance(text)}`
      )
    })

    // The claim distribution is the one input that comes from the relay, so try
    // the plausible spreads rather than assuming one.
    const cases: Array<[string, number[]]> = [
      ['no claims detected', []],
      ['claims in both body paragraphs', [2, 3]],
      ['claims in every paragraph', [1, 2, 3, 4]],
      ['claims in intro + body', [1, 2, 3]]
    ]

    for (const [label, claimParas] of cases) {
      const claimsByParagraph = new Map<number, string[]>(claimParas.map((i) => [i, [`c${i}`]]))
      const { roles, complete } = heuristicRoles({ paragraphs: spans(), claimsByParagraph })
      const outline = roles.map((role, i) => ({
        index: i + 1,
        role,
        hasWarrant: hasWarrantMarker(PARAGRAPHS[i]),
        claimIds: []
      }))
      const soWhat = hasClosingSignificance(PARAGRAPHS[PARAGRAPHS.length - 1])
      const result = scoreDraft(outline, { soWhatInConclusion: soWhat })
      console.log(`\n--- ${label} ---`)
      console.log('  roles     :', roles.join(', '))
      console.log('  complete  :', complete)
      console.log('  components:', JSON.stringify(result.components))
      console.log('  SCORE     :', result.score)
    }
  })
})
