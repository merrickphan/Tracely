/**
 * "Good morning" / "Good afternoon" / "Good evening".
 *
 * A leaf with no imports so `npm test` can load it, and taking the hour as a
 * parameter rather than reading the clock so the boundaries are testable — they
 * are the only thing here that can be wrong, and a greeting that says "good
 * evening" at 5pm to one person and "good afternoon" to another is the kind of
 * detail that reads as the app being careless.
 */
export function greetingFor(hour: number): string {
  if (!Number.isFinite(hour)) return 'Hello'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}
