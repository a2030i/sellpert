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
