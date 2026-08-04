type QuestionRecord = Record<string, unknown>

export type TrendyolQuestionRow = {
  merchant_code: string
  question_id: string
  status: string
  question_text: string
  customer_name: string | null
  show_customer_name: boolean
  product_name: string | null
  image_url: string | null
  barcode: string | null
  product_content_id: string | null
  answer_text: string | null
  answer_status: string | null
  asked_at: string | null
  answered_at: string | null
  provider_updated_at: string | null
  last_seen_at: string
  last_synced_at: string
  updated_at: string
}

function text(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : ''
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const normalized = text(value)
    if (normalized) return normalized
  }
  return ''
}

function timestamp(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  const parsed = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export function trendyolQuestionContent(result: unknown): QuestionRecord[] {
  if (!result || typeof result !== 'object') return []
  const value = result as Record<string, unknown>
  if (Array.isArray(value.content)) return value.content.filter(item => item && typeof item === 'object') as QuestionRecord[]
  const data = value.data
  if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).content)) {
    return ((data as Record<string, unknown>).content as unknown[]).filter(item => item && typeof item === 'object') as QuestionRecord[]
  }
  if (value.id !== undefined) return [value]
  return []
}

export function normalizeTrendyolQuestion(
  merchantCode: string,
  question: QuestionRecord,
  now = new Date().toISOString(),
): TrendyolQuestionRow | null {
  const questionId = firstText(question.id, question.questionId)
  const questionText = firstText(question.text, question.questionText)
  if (!merchantCode.trim() || !questionId || !questionText) return null
  const answer = question.answer && typeof question.answer === 'object'
    ? question.answer as QuestionRecord
    : null
  const product = question.product && typeof question.product === 'object'
    ? question.product as QuestionRecord
    : null
  const status = firstText(question.status, question.questionStatus).toUpperCase() || 'WAITING_FOR_ANSWER'
  return {
    merchant_code: merchantCode,
    question_id: questionId,
    status,
    question_text: questionText,
    customer_name: firstText(question.userName, question.customerName) || null,
    show_customer_name: question.showUserName === true,
    product_name: firstText(question.productName, product?.name) || null,
    image_url: firstText(question.imageUrl, question.productImageUrl, product?.imageUrl) || null,
    barcode: firstText(question.barcode, question.productBarcode, product?.barcode) || null,
    product_content_id: firstText(question.contentId, question.productContentId, product?.contentId) || null,
    answer_text: firstText(answer?.text, question.answerText) || null,
    answer_status: firstText(answer?.status, question.answerStatus) || null,
    asked_at: timestamp(question.creationDate ?? question.createdAt),
    answered_at: timestamp(answer?.creationDate ?? question.answeredDate),
    provider_updated_at: timestamp(question.lastModifiedDate ?? question.modifiedDate),
    last_seen_at: now,
    last_synced_at: now,
    updated_at: now,
  }
}

export function normalizeTrendyolQuestionPage(
  merchantCode: string,
  result: unknown,
  now = new Date().toISOString(),
) {
  return trendyolQuestionContent(result)
    .map(question => normalizeTrendyolQuestion(merchantCode, question, now))
    .filter((row): row is TrendyolQuestionRow => row !== null)
}
