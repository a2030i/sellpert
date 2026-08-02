import { describe, expect, it } from 'vitest'
import { normalizeAiInsightContent } from '../aiInsights'

describe('normalizeAiInsightContent', () => {
  it('keeps the expected insight schema unchanged', () => {
    const result = normalizeAiInsightContent({
      summary: 'ملخص',
      best_days: ['الجمعة', 'السبت'],
      recommendations: ['ارفع المخزون'],
      forecast_next_week: { amount: 1200, confidence: 'high', reasoning: 'نمو ثابت' },
    })

    expect(result.best_days).toEqual(['الجمعة', 'السبت'])
    expect(result.recommendations).toEqual(['ارفع المخزون'])
    expect(result.forecast_next_week?.amount).toBe(1200)
  })

  it('normalizes legacy strings and structured recommendation objects', () => {
    const result = normalizeAiInsightContent({
      best_days: 'الجمعة، السبت',
      recommendations: [
        { action: 'زد الميزانية', priority: 'high' },
        { recommendation: 'راجع الأسعار' },
      ],
    })

    expect(result.best_days).toEqual(['الجمعة', 'السبت'])
    expect(result.recommendations).toEqual(['زد الميزانية', 'راجع الأسعار'])
  })

  it('drops unrenderable values instead of leaking objects into React', () => {
    const result = normalizeAiInsightContent({
      summary: { unexpected: ['value'] },
      best_days: { unexpected: true },
      recommendations: [null, {}, { priority: 'low' }, 42],
    })

    expect(result.summary).toBeUndefined()
    expect(result.best_days).toEqual([])
    expect(result.recommendations).toEqual(['42'])
  })
})
