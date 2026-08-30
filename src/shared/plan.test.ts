import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_PLAN,
  MODEL_TIERS,
  PLAN_MODEL_CEILING,
  isModelTier,
  isPlan,
  modelTierUnlocked,
  normalizePlan,
  planFromMetadata,
  resolveModelTier
} from './plan.ts'

describe('normalizePlan', () => {
  it('takes the three real plans', () => {
    strictEqual(normalizePlan('free'), 'free')
    strictEqual(normalizePlan('student'), 'student')
    strictEqual(normalizePlan('pro'), 'pro')
  })

  it('forgives case and space, because the writer is not this app', () => {
    strictEqual(normalizePlan(' Pro '), 'pro')
    strictEqual(normalizePlan('STUDENT'), 'student')
  })

  it('answers free for anything it does not recognise', () => {
    // A plan name from a future pricing page, a null column, a hand edit.
    strictEqual(normalizePlan('enterprise'), 'free')
    strictEqual(normalizePlan(''), 'free')
    strictEqual(normalizePlan(null), 'free')
    strictEqual(normalizePlan(undefined), 'free')
    strictEqual(normalizePlan(7), 'free')
    strictEqual(normalizePlan({ plan: 'pro' }), 'free')
    strictEqual(DEFAULT_PLAN, 'free')
  })
})

describe('planFromMetadata', () => {
  it('reads app_metadata', () => {
    strictEqual(planFromMetadata({ plan: 'student' }, {}), 'student')
  })

  it('falls back to user_metadata when the server set nothing', () => {
    strictEqual(planFromMetadata({}, { plan: 'student' }), 'student')
    strictEqual(planFromMetadata(null, { plan: 'pro' }), 'pro')
  })

  it('never lets user_metadata overrule app_metadata', () => {
    // user_metadata is writable by the account holder through
    // auth.updateUser — if it could win, it would be an upgrade button.
    strictEqual(planFromMetadata({ plan: 'free' }, { plan: 'pro' }), 'free')
  })

  it('is free when neither says anything', () => {
    strictEqual(planFromMetadata({}, {}), 'free')
    strictEqual(planFromMetadata(undefined, undefined), 'free')
    strictEqual(planFromMetadata('pro', 'pro'), 'free')
  })
})

describe('resolveModelTier', () => {
  it('gives each plan its ceiling when nothing is preferred', () => {
    strictEqual(resolveModelTier(undefined, 'free'), 'fast')
    strictEqual(resolveModelTier(undefined, 'student'), 'balanced')
    strictEqual(resolveModelTier(undefined, 'pro'), 'thorough')
  })

  it('holds a free account to the fast tier whatever is stored', () => {
    // The case this function exists for: a lapsed Pro subscription leaves
    // 'thorough' in the settings row long after the plan went away.
    strictEqual(resolveModelTier('thorough', 'free'), 'fast')
    strictEqual(resolveModelTier('balanced', 'free'), 'fast')
  })

  it('clamps a student to the mid tier', () => {
    strictEqual(resolveModelTier('thorough', 'student'), 'balanced')
    strictEqual(resolveModelTier('balanced', 'student'), 'balanced')
  })

  it('honours a preference at or below the ceiling', () => {
    strictEqual(resolveModelTier('fast', 'pro'), 'fast')
    strictEqual(resolveModelTier('balanced', 'pro'), 'balanced')
    strictEqual(resolveModelTier('thorough', 'pro'), 'thorough')
  })

  it('cannot be talked past by a value that is not a tier', () => {
    strictEqual(resolveModelTier('opus', 'free'), 'fast')
    strictEqual(resolveModelTier({ tier: 'thorough' }, 'free'), 'fast')
    strictEqual(resolveModelTier(null, 'free'), 'fast')
    strictEqual(resolveModelTier('thorough', 'nonsense' as never), 'fast')
  })

  it('never returns a tier the plan has not unlocked', () => {
    for (const plan of ['free', 'student', 'pro'] as const) {
      for (const preferred of [...MODEL_TIERS, 'wat', null, 99]) {
        strictEqual(modelTierUnlocked(resolveModelTier(preferred, plan), plan), true)
      }
    }
  })
})

describe('modelTierUnlocked', () => {
  it('is the plan ceiling, read the other way round', () => {
    deepStrictEqual(
      MODEL_TIERS.filter((t) => modelTierUnlocked(t, 'free')),
      ['fast']
    )
    deepStrictEqual(
      MODEL_TIERS.filter((t) => modelTierUnlocked(t, 'student')),
      ['fast', 'balanced']
    )
    deepStrictEqual(
      MODEL_TIERS.filter((t) => modelTierUnlocked(t, 'pro')),
      ['fast', 'balanced', 'thorough']
    )
    strictEqual(PLAN_MODEL_CEILING.free, 'fast')
  })
})

describe('guards', () => {
  it('recognise their own values and nothing else', () => {
    strictEqual(isPlan('pro'), true)
    strictEqual(isPlan('Pro'), false)
    strictEqual(isModelTier('thorough'), true)
    strictEqual(isModelTier('haiku'), false)
  })
})
