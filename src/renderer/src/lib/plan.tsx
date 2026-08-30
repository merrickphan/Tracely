import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_PLAN, type Plan } from '@shared/plan'
import { tracelyApi } from './api'

/**
 * Which plan this window is running as.
 *
 * Context rather than a prop for the same reason the grading level is one: the
 * places that care — Settings > Billing, the model-tier rows in Preferences —
 * have nothing else in common, and threading a plan through view layers is how
 * a gate ends up applied in two places out of three.
 *
 * **Nothing here decides what a call is allowed to do.** The renderer's copy of
 * the plan draws locks and an upgrade prompt; the tier a check, critique or
 * grade actually runs at is resolved in the main process on every relay call
 * (services/ai/modelTier.ts). A renderer that lied about its plan would win
 * itself an unlocked dropdown and nothing else.
 *
 * `free` until the first read resolves, and `free` if it fails. Briefly showing
 * an upgrade prompt to a subscriber is a worse look than the reverse is a bug,
 * and only one of the two is recoverable by the user pressing something.
 */
const PlanContext = createContext<Plan>(DEFAULT_PLAN)

export function PlanProvider({ children }: { children: ReactNode }): JSX.Element {
  const [plan, setPlan] = useState<Plan>(DEFAULT_PLAN)

  useEffect(() => {
    const read = (): void => {
      tracelyApi
        .getPlan()
        .then((res) => setPlan(res.plan))
        .catch(() => setPlan(DEFAULT_PLAN))
    }
    read()
    // A plan changes without the user changing — a subscription bought on the
    // website, or one that lapsed. supabase-js emits this on sign-in, sign-out
    // AND on every token refresh, so re-reading here is what carries an upgrade
    // into a window that has been open all day.
    return tracelyApi.onAuthStateChanged(() => read())
  }, [])

  return <PlanContext.Provider value={plan}>{children}</PlanContext.Provider>
}

/** The current plan. `free` outside a provider. */
export function usePlan(): Plan {
  return useContext(PlanContext)
}
