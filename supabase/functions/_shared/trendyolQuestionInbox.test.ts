import { assertEquals } from 'jsr:@std/assert@1'
import { missingWaitingQuestionIds, normalizeTrendyolQuestion, normalizeTrendyolQuestionPage, trendyolQuestionContent } from './trendyolQuestionInbox.ts'

Deno.test('normalizes a Trendyol question without retaining the provider payload', () => {
  const row = normalizeTrendyolQuestion('merchant-1', {
    id: 123,
    text: 'هل المنتج متوفر؟',
    status: 'WAITING_FOR_ANSWER',
    userName: 'عميل',
    showUserName: false,
    productName: 'منتج تجريبي',
    imageUrl: 'https://example.test/image.jpg',
    barcode: '8690001',
    contentId: 456,
    creationDate: 1_725_000_000_000,
    unexpectedSecret: 'must-not-be-retained',
  }, '2026-08-04T00:00:00.000Z')

  assertEquals(row, {
    merchant_code: 'merchant-1',
    question_id: '123',
    status: 'WAITING_FOR_ANSWER',
    question_text: 'هل المنتج متوفر؟',
    customer_name: null,
    show_customer_name: false,
    product_name: 'منتج تجريبي',
    image_url: 'https://example.test/image.jpg',
    barcode: '8690001',
    product_content_id: '456',
    answer_text: null,
    answer_status: null,
    asked_at: '2024-08-30T06:40:00.000Z',
    answered_at: null,
    provider_updated_at: null,
    last_seen_at: '2026-08-04T00:00:00.000Z',
    last_synced_at: '2026-08-04T00:00:00.000Z',
    updated_at: '2026-08-04T00:00:00.000Z',
  })
})

Deno.test('retains a Trendyol customer name only when the provider permits it', () => {
  assertEquals(normalizeTrendyolQuestion('merchant-1', {
    id: 'visible-name', text: 'question', userName: 'Visible Customer', showUserName: true,
  })?.customer_name, 'Visible Customer')
  assertEquals(normalizeTrendyolQuestion('merchant-1', {
    id: 'hidden-name', text: 'question', userName: 'Hidden Customer', showUserName: false,
  })?.customer_name, null)
})

Deno.test('extracts both list pages and detail responses', () => {
  const page = { content:[{ id:'1', text:'one' }, null], totalElements:1 }
  assertEquals(trendyolQuestionContent(page).length, 1)
  assertEquals(trendyolQuestionContent({ id:'2', text:'two' }).length, 1)
  assertEquals(normalizeTrendyolQuestionPage('m', { data:page }).map(row => row.question_id), ['1'])
})

Deno.test('drops malformed questions instead of creating ambiguous tenant rows', () => {
  assertEquals(normalizeTrendyolQuestion('m', { id:'', text:'question' }), null)
  assertEquals(normalizeTrendyolQuestion('m', { id:'1', text:'  ' }), null)
  assertEquals(normalizeTrendyolQuestion('', { id:'1', text:'question' }), null)
})

Deno.test('finds cached waiting questions missing from a complete provider page', () => {
  assertEquals(
    missingWaitingQuestionIds(['10', '20', '30'], [{ question_id:'20' }, { question_id:'30' }] as any),
    ['10'],
  )
})
