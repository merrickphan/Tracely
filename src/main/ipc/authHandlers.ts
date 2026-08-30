import { ipcMain, shell } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type {
  AuthDeleteAccountResponse,
  AuthGetPlanResponse,
  AuthGetUserResponse,
  AuthSignInWithGoogleResponse,
  AuthSignOutResponse,
  AuthSignResponse,
  AuthUpdateNameResponse,
  AuthUpdateUsernameResponse
} from '@shared/ipc-contract'
import {
  deleteAccount,
  getCurrentUser,
  isAuthConfigured,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  startGoogleOAuth,
  updateFirstName,
  updateUsername
} from '../services/auth/client'
import { getCurrentPlan } from '../services/auth/plan'

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
})

const signUpSchema = credentialsSchema.extend({
  firstName: z.string().trim().min(1)
})

const nameSchema = z.object({
  firstName: z.string().trim().min(1)
})

// Loose on purpose — this doubles as the fallback display value for
// password accounts too (see extractUsername in auth/client.ts), so
// anything a real email-shaped default could look like has to pass, not
// just handle-style names.
const usernameSchema = z.object({
  username: z.string().trim().min(1).max(255)
})

export function registerAuthHandlers(): void {
  ipcMain.handle(IPC.AUTH_GET_USER, async (): Promise<AuthGetUserResponse> => {
    if (!isAuthConfigured()) return { user: null, configured: false }
    return { user: await getCurrentUser(), configured: true }
  })

  ipcMain.handle(IPC.AUTH_SIGN_UP, async (_event, raw): Promise<AuthSignResponse> => {
    const { email, password, firstName } = signUpSchema.parse(raw)
    return { user: await signUpWithPassword(email, password, firstName) }
  })

  ipcMain.handle(IPC.AUTH_SIGN_IN, async (_event, raw): Promise<AuthSignResponse> => {
    const { email, password } = credentialsSchema.parse(raw)
    return { user: await signInWithPassword(email, password) }
  })

  ipcMain.handle(IPC.AUTH_SIGN_OUT, async (): Promise<AuthSignOutResponse> => {
    await signOut()
    return { ok: true }
  })

  ipcMain.handle(IPC.AUTH_SIGN_IN_WITH_GOOGLE, async (): Promise<AuthSignInWithGoogleResponse> => {
    const url = await startGoogleOAuth()
    await shell.openExternal(url)
    return { ok: true }
  })

  ipcMain.handle(IPC.AUTH_UPDATE_NAME, async (_event, raw): Promise<AuthUpdateNameResponse> => {
    const { firstName } = nameSchema.parse(raw)
    return { user: await updateFirstName(firstName) }
  })

  ipcMain.handle(IPC.AUTH_UPDATE_USERNAME, async (_event, raw): Promise<AuthUpdateUsernameResponse> => {
    const { username } = usernameSchema.parse(raw)
    return { user: await updateUsername(username) }
  })

  ipcMain.handle(IPC.AUTH_DELETE_ACCOUNT, async (): Promise<AuthDeleteAccountResponse> => {
    await deleteAccount()
    return { ok: true }
  })

  // Separate from AUTH_GET_USER rather than a field on AuthUser: a plan changes
  // without the user changing — a subscription starts on the website while the
  // app is open, or lapses — so the renderer has to be able to ask again. It
  // re-asks on every auth-state change, which supabase-js also emits on a token
  // refresh, so an upgrade lands on its own within the hour.
  ipcMain.handle(IPC.AUTH_GET_PLAN, async (): Promise<AuthGetPlanResponse> => {
    return { plan: await getCurrentPlan() }
  })
}
