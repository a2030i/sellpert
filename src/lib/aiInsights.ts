export interface NormalizedAiInsightContent {
  summary?: string
  best_days: string[]
  best_platforms: { platform: string; reason: string }[]
  seasonal_insights: string[]
  forecast_next_week?: { amount: number; confidence: string; reasoning?: string }
  top_products: { name: string; revenue: number; trend: 'up' | 'down' | 'stable' }[]
  recommendations: string[]
  low_stock_alert: string[]
}

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (!value || typeof value !== 'object') return undefined

  const record = value as Record<string, unknown>
  for (const key of ['action', 'recommendation', 'text', 'title', 'description', 'name', 'day', 'value']) {
    const candidate = textValue(record[key])
    if (candidate) return candidate
  }
  return undefined
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(textValue).filter((item): item is string => Boolean(item))
  }

  const single = textValue(value)
  if (!single) return []
  return single
    .split(/\r?\n|[,،؛;]/)
    .map(item => item.replace(/^[-•\d.)\s]+/, '').trim())
    .filter(Boolean)
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export function normalizeAiInsightContent(value: unknown): NormalizedAiInsightContent {
  const content = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  const forecastRaw = content.forecast_next_week
  const forecast = forecastRaw && typeof forecastRaw === 'object' && !Array.isArray(forecastRaw)
    ? forecastRaw as Record<string, unknown>
    : null

  const bestPlatforms = Array.isArray(content.best_platforms)
    ? content.best_platforms.flatMap(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const record = item as Record<string, unknown>
        const platform = textValue(record.platform)
        if (!platform) return []
        return [{ platform, reason: textValue(record.reason) || '' }]
      })
    : []

  const topProducts = Array.isArray(content.top_products)
    ? content.top_products.flatMap(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const record = item as Record<string, unknown>
        const name = textValue(record.name)
        if (!name) return []
        const trend: 'up' | 'down' | 'stable' = record.trend === 'up' || record.trend === 'down' || record.trend === 'stable'
          ? record.trend
          : 'stable'
        return [{ name, revenue: numberValue(record.revenue) || 0, trend }]
      })
    : []

  return {
    summary: textValue(content.summary),
    best_days: textList(content.best_days),
    best_platforms: bestPlatforms,
    seasonal_insights: textList(content.seasonal_insights),
    forecast_next_week: forecast ? {
      amount: numberValue(forecast.amount) || 0,
      confidence: textValue(forecast.confidence) || 'غير محددة',
      reasoning: textValue(forecast.reasoning),
    } : undefined,
    top_products: topProducts,
    recommendations: textList(content.recommendations),
    low_stock_alert: textList(content.low_stock_alert),
  }
}
