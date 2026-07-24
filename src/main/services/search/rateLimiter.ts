const lastCallAt = new Map<string, number>()

/** Ensures at least `minIntervalMs` passes between calls sharing the same `key`. */
export async function throttle(key: string, minIntervalMs: number): Promise<void> {
  const last = lastCallAt.get(key) ?? 0
  const wait = last + minIntervalMs - Date.now()
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait))
  }
  lastCallAt.set(key, Date.now())
}
