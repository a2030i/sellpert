import { assertEquals, assertThrows } from 'jsr:@std/assert'
import { validateTrendyolAnswerText, validateTrendyolQuestionQuery } from './trendyolQuestions.ts'

Deno.test('Trendyol question answers are trimmed and bounded', () => {
  assertEquals(validateTrendyolAnswerText('  المنتج متوفر حاليًا  '), 'المنتج متوفر حاليًا')
  assertThrows(() => validateTrendyolAnswerText('قصير'), Error, '10 أحرف')
  assertThrows(() => validateTrendyolAnswerText('x'.repeat(2001)), Error, '2000 حرف')
})

Deno.test('Trendyol question query enforces status, pagination and two-week range', () => {
  validateTrendyolQuestionQuery({ status:'WAITING_FOR_ANSWER', page:0, size:50, startDate:1_000, endDate:1_000 + 14 * 24 * 60 * 60 * 1000 })
  assertThrows(() => validateTrendyolQuestionQuery({ status:'UNKNOWN' }), Error, 'حالة')
  assertThrows(() => validateTrendyolQuestionQuery({ size:51 }), Error, 'بين 1 و50')
  assertThrows(() => validateTrendyolQuestionQuery({ startDate:1_000, endDate:1_000 + 15 * 24 * 60 * 60 * 1000 }), Error, 'أسبوعين')
})
