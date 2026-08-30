import { resolveModelTier, type ModelTier } from '@shared/plan'
import { getSetting } from '../storage/settingsRepo'
import { getPlan } from './identity'

/**
 * The model tier every relay call runs at — checks, critique and grading alike.
 *
 * **This is the enforcement point, and it is main-side on purpose.** The
 * preference is a stored string in SQLite; the plan is what the account has
 * actually paid for. Deciding it in the renderer, or trusting the row on its
 * own, would mean a Pro subscription that lapsed last month still asks for the
 * top model — the row outlives the plan, and nothing rewrites it when a
 * subscription ends. `resolveModelTier` clamps, so the answer can never exceed
 * the plan's ceiling however the preference got there.
 *
 * Every AI call in this app goes through `callRelay`, which is why the gate
 * sits one import away from it rather than at each of the seven endpoints: a
 * new endpoint is gated by existing, not by remembering.
 */
export async function modelTierForCall(): Promise<ModelTier> {
  return resolveModelTier(getSetting('modelTier'), await getPlan())
}
