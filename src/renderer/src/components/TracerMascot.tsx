/**
 * Tracer — the paper-plane character, drawn as inline SVG.
 *
 * From the reference art the owner supplied: a cream paper dart pointing down
 * and left, an orange underside triangle, a heavy black outline, two big eyes
 * with highlights, and two white-gloved hands — one raised in a wave.
 *
 * Inline SVG rather than a bitmap for the reasons every other mark in this app
 * is (see icons.tsx): it stays crisp at any size and on any DPI, it costs no
 * asset pipeline, and the one colour that has to match the palette — the orange
 * — is a token here rather than baked into pixels.
 *
 * `aria-hidden`, because the mascot is decoration beside a button that already
 * says "Chat with Tracer". Announcing it would read the same thing twice.
 */
export default function TracerMascot({ size = 44 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      className="tracer-mascot"
    >
      {/* Arms first, so the dart's body overlaps them where they meet it —
          which is what gives the character its "peeking out from behind"
          silhouette rather than looking like a plane with sticks attached. */}
      <path d="M30 44 Q20 42 17 33" stroke="#111" strokeWidth="9" strokeLinecap="round" />
      <path d="M72 62 Q80 66 79 73" stroke="#111" strokeWidth="9" strokeLinecap="round" />

      {/* Gloves. The raised one is the wave. */}
      <circle cx="16" cy="30" r="8.5" fill="#fff" stroke="#111" strokeWidth="2.6" />
      <circle cx="80" cy="75" r="7.5" fill="#fff" stroke="#111" strokeWidth="2.6" />

      {/* The dart. One outline, filled cream, with the fold running from the
          nose to the tail — the fold is what makes it read as folded paper
          instead of as a triangle. */}
      <path
        d="M88 14 L34 86 L30 44 Z"
        fill="#f7efe3"
        stroke="#111"
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      <path d="M88 14 L30 44" stroke="#111" strokeWidth="2.2" strokeLinejoin="round" />
      {/* The shaded underside and the orange keel, both read off the reference. */}
      <path d="M88 14 L34 86 L52 60 Z" fill="#e6dccb" />
      <path d="M34 86 L52 60 L60 74 Z" fill="#e8761c" stroke="#111" strokeWidth="2.4" strokeLinejoin="round" />

      {/* Face. Set on the upper wing, where the reference puts it. */}
      <ellipse cx="57" cy="36" rx="5.2" ry="6.4" fill="#111" />
      <ellipse cx="72" cy="41" rx="5.2" ry="6.4" fill="#111" />
      <circle cx="58.8" cy="33.4" r="1.9" fill="#fff" />
      <circle cx="73.8" cy="38.4" r="1.9" fill="#fff" />
      <path d="M52 26 Q57 23 62 26" stroke="#111" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M67 31 Q72 28 77 31" stroke="#111" strokeWidth="2.6" strokeLinecap="round" />
      {/* An open smile: the dark mouth with a tongue, which is what stops it
          reading as a grimace at small sizes. */}
      <path d="M60 50 Q66 58 72 51 Q66 47 60 50 Z" fill="#111" />
      <path d="M64 53 Q66.5 57 69 53 Z" fill="#f08a6a" />
    </svg>
  )
}
