export const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'completed', 'archived']

export const TRANSITIONS = {
  draft: ['active', 'archived'],
  active: ['paused', 'completed', 'archived'],
  paused: ['active', 'archived'],
  completed: ['archived'],
  archived: [],
}

export const MAX_BUDGET_CENTS = 10_000_000

export function canTransition(from, to) {
  if (from === to) return true
  return (TRANSITIONS[from] || []).includes(to)
}

export function allowedNextStatuses(from) {
  const next = TRANSITIONS[from] || []
  return [from, ...next.filter((s) => s !== from)]
}

export function parseBudgetCents(value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return { ok: false, code: 'INVALID_BUDGET', message: 'Budget must be a non-negative integer (cents).' }
  }
  if (value > MAX_BUDGET_CENTS) {
    return { ok: false, code: 'INVALID_BUDGET', message: 'Budget exceeds the maximum allowed for this environment.' }
  }
  return { ok: true, value }
}
