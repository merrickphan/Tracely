import { DEFAULT_PLAN, planFromMetadata, type Plan } from '@shared/plan'
import { getSupabase, isAuthConfigured } from './client'

/**
 * The plan the signed-in account is on — the app's single source of truth.
 *
 * Everything that gates on a plan (the model tier a relay call runs at, the
 * Billing panel, the locked rows in Settings) resolves through here rather than
 * reading metadata itself, so there is one definition of "which plan is this"
 * and one place a wrong answer can come from.
 *
 * **It cannot throw and it cannot answer high.** A build with no Supabase
 * project, a signed-out session, an expired refresh that fails, a metadata
 * shape nobody expected — all of it is `free`. This runs on the path every AI
 * call takes, so throwing here would turn "we could not read your plan" into
 * "your check failed", and answering optimistically would hand the top model to
 * an account that is not paying for it.
 *
 * Read fresh rather than cached, for the same reason `getAccessToken` is: the
 * session is in memory inside supabase-js, and a plan that changed on the
 * website should not need a restart to take effect.
 */
export async function getCurrentPlan(): Promise<Plan> {
  if (!isAuthConfigured()) return DEFAULT_PLAN
  try {
    const { data, error } = await getSupabase().auth.getSession()
    if (error) return DEFAULT_PLAN
    const user = data.session?.user
    if (!user) return DEFAULT_PLAN
    return planFromMetadata(user.app_metadata, user.user_metadata)
  } catch {
    return DEFAULT_PLAN
  }
}
