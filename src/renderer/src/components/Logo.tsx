import logo from '../assets/logo.png'

// The real brand mark (user-supplied artwork) rendered as a small rounded
// badge — replaces the earlier hand-approximated SVG now that we have the
// actual asset instead of a guess at its shape.
export default function Logo({ size = 24 }: { size?: number }): JSX.Element {
  return (
    <img
      src={logo}
      alt=""
      width={size}
      height={size}
      style={{ borderRadius: Math.round(size * 0.22), display: 'block', objectFit: 'cover' }}
    />
  )
}
