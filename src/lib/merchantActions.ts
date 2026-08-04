import { supabase } from './supabase'

export type ActionPriority = 'low' | 'medium' | 'high' | 'urgent'

export type CreateMerchantActionInput = {
  sourceKey: string
  title: string
  category?: string
  priority?: ActionPriority
  note?: string
  expectedImpact?: string
  details?: Record<string, unknown>
  dueDate?: string | null
}

export async function createMerchantAction(input: CreateMerchantActionInput) {
  const { data, error } = await supabase.rpc('create_my_action', {
    p_source_key: input.sourceKey,
    p_title: input.title,
    p_category: input.category || 'operations',
    p_priority: input.priority || 'medium',
    p_note: input.note || null,
    p_expected_impact: input.expectedImpact || null,
    p_details: input.details || {},
    p_due_date: input.dueDate || null,
  })
  if (error) throw error
  return data as { id: string; created: boolean }
}

export async function updateMerchantActionStatus(actionId: string, status: 'pending' | 'in_progress' | 'done') {
  const { data, error } = await supabase.rpc('update_my_action_status', {
    p_action_id: actionId,
    p_status: status,
  })
  if (error) throw error
  return data as { id: string; status: string }
}

export type ActionCompletionResult = 'achieved' | 'partial' | 'not_achieved'

export type ActionEffectivenessCategory = {
  category: string
  completed: number
  achieved: number
  partial: number
  not_achieved: number
  achieved_rate_pct: number | null
}

export type ActionEffectivenessWeek = {
  week_start: string
  completed: number
  achieved: number
  partial: number
  not_achieved: number
}

export type ActionEffectiveness = {
  period_days: number
  generated_at: string | null
  open: {
    total: number
    in_progress: number
    urgent: number
    overdue: number
    due_next_7_days: number
  }
  completed: {
    total: number
    achieved: number
    partial: number
    not_achieved: number
    unmeasured: number
    measured: number
    achieved_rate_pct: number | null
    positive_rate_pct: number | null
    average_cycle_days: number | null
  }
  categories: ActionEffectivenessCategory[]
  weeks: ActionEffectivenessWeek[]
}

const numberOrZero = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const nullableNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeActionEffectiveness(value: unknown): ActionEffectiveness | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const open = raw.open && typeof raw.open === 'object' && !Array.isArray(raw.open)
    ? raw.open as Record<string, unknown> : {}
  const completed = raw.completed && typeof raw.completed === 'object' && !Array.isArray(raw.completed)
    ? raw.completed as Record<string, unknown> : {}
  const categories = Array.isArray(raw.categories) ? raw.categories : []
  const weeks = Array.isArray(raw.weeks) ? raw.weeks : []

  return {
    period_days: Math.max(30, numberOrZero(raw.period_days) || 90),
    generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : null,
    open: {
      total: numberOrZero(open.total),
      in_progress: numberOrZero(open.in_progress),
      urgent: numberOrZero(open.urgent),
      overdue: numberOrZero(open.overdue),
      due_next_7_days: numberOrZero(open.due_next_7_days),
    },
    completed: {
      total: numberOrZero(completed.total),
      achieved: numberOrZero(completed.achieved),
      partial: numberOrZero(completed.partial),
      not_achieved: numberOrZero(completed.not_achieved),
      unmeasured: numberOrZero(completed.unmeasured),
      measured: numberOrZero(completed.measured),
      achieved_rate_pct: nullableNumber(completed.achieved_rate_pct),
      positive_rate_pct: nullableNumber(completed.positive_rate_pct),
      average_cycle_days: nullableNumber(completed.average_cycle_days),
    },
    categories: categories.flatMap(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const row = item as Record<string, unknown>
      if (typeof row.category !== 'string' || !row.category) return []
      return [{
        category: row.category,
        completed: numberOrZero(row.completed),
        achieved: numberOrZero(row.achieved),
        partial: numberOrZero(row.partial),
        not_achieved: numberOrZero(row.not_achieved),
        achieved_rate_pct: nullableNumber(row.achieved_rate_pct),
      }]
    }),
    weeks: weeks.flatMap(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const row = item as Record<string, unknown>
      if (typeof row.week_start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.week_start)) return []
      return [{
        week_start: row.week_start,
        completed: numberOrZero(row.completed),
        achieved: numberOrZero(row.achieved),
        partial: numberOrZero(row.partial),
        not_achieved: numberOrZero(row.not_achieved),
      }]
    }),
  }
}

export async function getMyActionEffectiveness(days = 90) {
  const { data, error } = await supabase.rpc('my_action_effectiveness', {
    p_days: Math.max(30, Math.min(Math.round(days), 365)),
  })
  if (error) throw error
  const normalized = normalizeActionEffectiveness(data)
  if (!normalized) throw new Error('INVALID_ACTION_EFFECTIVENESS_RESPONSE')
  return normalized
}

const ACTION_DESTINATIONS = new Set([
  '/dashboard', '/orders', '/customers', '/products', '/inventory',
  '/statement', '/marketing', '/integrations', '/store-status',
])

export function actionDestination(details: unknown): string | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const destination = (details as Record<string, unknown>).destination
  if (typeof destination !== 'string' || !destination.startsWith('/')) return null
  const [path] = destination.split('?')
  return ACTION_DESTINATIONS.has(path) ? destination : null
}

export async function completeMerchantAction(actionId: string, result: ActionCompletionResult, note: string) {
  const { data, error } = await supabase.rpc('complete_my_action', {
    p_action_id: actionId,
    p_result: result,
    p_note: note,
  })
  if (error) throw error
  return data as { id: string; status: 'done'; result: ActionCompletionResult }
}

export function dueDateFromNow(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}
