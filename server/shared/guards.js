/**
 * Cost guards — every automatic path needs a bound. Centralized so each one is
 * testable, and so nobody re-invents a cap inline. Two caps are not one cap:
 * per-analysis caps assume analyses are discrete units (they aren't, under
 * debounced live detection), so the rolling-window cap is the backstop.
 */

export const GUARDS = {
  maxInputChars: 30_000,          // how much text reaches any model call
  maxClaimsPerAnalysis: 40,       // how many claims one detection pass may produce
  maxAutoCritiqueClaims: 6,       // paid fact-checks per analysis, once per analysis id
  maxWebSearchesPerAnalysis: 4,   // paid searches per document analysis
  maxWebSearchesPerHour: 15,      // the backstop when "one analysis" stops meaning anything
  maxAutoSourcesPerCycle: 3,
  evidenceConcurrency: 3,         // claims searched at once in the sweep
  providerTimeoutMs: 6_000,       // a slow index returns empty, not late

  // Live-detect bounds ported from the production app's shared/liveDetect.ts,
  // which solved this already: 2.5s idle (past a comma, short of a reread),
  // a sentence-sized delta (fixing a typo and pausing must not re-read the
  // document), and a 15s floor — the idle timer alone bounds nothing, since
  // type-pause-type clears it forever.
  detect: {
    idleMs: 2500,                 // typing pause before detection may fire
    minChars: 80,                 // minimum draft length
    minDelta: 80,                 // minimum change since last run — sentence-sized
    minIntervalMs: 15_000,        // the hard floor between calls — the real ceiling
  },
};

/**
 * Rolling-window counter. stamp() BEFORE the call, not after — otherwise it
 * measures the gap between answers instead of between requests.
 */
export function rollingCounter(limit, windowMs = 3_600_000) {
  let times = [];
  return {
    ok() {
      const now = Date.now();
      times = times.filter((t) => now - t < windowMs);
      return times.length < limit;
    },
    stamp() {
      times.push(Date.now());
    },
    count() {
      const now = Date.now();
      times = times.filter((t) => now - t < windowMs);
      return times.length;
    },
  };
}

/**
 * Debounce-floor gate for live detection. The idle timer bounds nothing on its
 * own (type-pause-type clears it forever); the floor between calls is the
 * actual ceiling, stamped before the call.
 */
export function detectGate() {
  let lastRunAt = 0;
  let lastText = "";
  return {
    shouldRun(text, now = Date.now()) {
      if (text.length < GUARDS.detect.minChars) return false;
      if (text === lastText) return false;
      if (Math.abs(text.length - lastText.length) < GUARDS.detect.minDelta) return false;
      if (now - lastRunAt < GUARDS.detect.minIntervalMs) return false;
      return true;
    },
    stamp(text, now = Date.now()) {
      lastRunAt = now; // before the call
      lastText = text;
    },
  };
}
