export function validateTrendyolAnswerText(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length < 10) throw new Error('يجب ألا يقل الرد عن 10 أحرف')
  if (text.length > 2000) throw new Error('يجب ألا يزيد الرد عن 2000 حرف')
  return text
}

export function validateTrendyolQuestionQuery(query: any) {
  const allowedStatuses = new Set(['WAITING_FOR_ANSWER','ANSWERED','REJECTED','REPORTED','UNANSWERED'])
  const status = String(query?.status || '').trim().toUpperCase()
  if (status && !allowedStatuses.has(status)) throw new Error('حالة أسئلة Trendyol غير صالحة')
  const page = Number(query?.page ?? 0)
  const size = Number(query?.size ?? 50)
  if (!Number.isInteger(page) || page < 0) throw new Error('رقم صفحة الأسئلة غير صالح')
  if (!Number.isInteger(size) || size < 1 || size > 50) throw new Error('عدد الأسئلة في الصفحة يجب أن يكون بين 1 و50')
  const startDate = query?.startDate === undefined ? null : Number(query.startDate)
  const endDate = query?.endDate === undefined ? null : Number(query.endDate)
  if ((startDate !== null && (!Number.isFinite(startDate) || startDate < 1)) || (endDate !== null && (!Number.isFinite(endDate) || endDate < 1))) {
    throw new Error('نطاق تاريخ الأسئلة غير صالح')
  }
  if (startDate !== null && endDate !== null && (endDate < startDate || endDate - startDate > 14 * 24 * 60 * 60 * 1000)) {
    throw new Error('نطاق أسئلة Trendyol يجب ألا يتجاوز أسبوعين')
  }
}
