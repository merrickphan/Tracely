// Vector mark instead of the raster app icon — lets it render crisply at any
// size and take the accent gradient directly, rather than needing a
// separately-exported colored PNG (no raster editing tooling available to
// recolor the existing black/white icon.png).
export default function Logo({ size = 24 }: { size?: number }): JSX.Element {
  const gradientId = 'tracely-logo-gradient'
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={gradientId} x1="20" y1="30" x2="85" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffab3d" />
          <stop offset="1" stopColor="#ff5a36" />
        </linearGradient>
      </defs>
      <path d="M 20 32 Q 52 22, 85 33 Q 60 45, 50 90 Q 46 55, 20 32 Z" fill={`url(#${gradientId})`} />
    </svg>
  )
}
