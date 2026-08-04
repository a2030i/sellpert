import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import {
  normalizeTrendyolCancelPayload,
  normalizeTrendyolSplitPayload,
  requestedTrendyolPackageLines,
  trendyolPackageLinesAreAvailable,
} from './trendyolPackageMutations.ts'

Deno.test('normalizes only documented Trendyol cancellation reasons and positive lines', () => {
  const payload = normalizeTrendyolCancelPayload({ lines:[{ lineId:'12', quantity:'2' }], reasonId:'500' })
  assertEquals(payload, { lines:[{ lineId:12, quantity:2 }], reasonId:500, shouldKeepPreviousStatus:true })
  assertThrows(() => normalizeTrendyolCancelPayload({ lines:[{ lineId:12, quantity:1 }], reasonId:999 }))
  assertThrows(() => normalizeTrendyolCancelPayload({ lines:[{ lineId:12, quantity:0 }], reasonId:500 }))
})

Deno.test('normalizes documented split-packages payload', () => {
  const payload = normalizeTrendyolSplitPayload({ splitPackages:[{ packageDetails:[{ orderLineId:'12', quantities:'1' }] }] })
  assertEquals(payload, { splitPackages:[{ packageDetails:[{ orderLineId:12, quantities:1 }] }], shouldKeepPreviousStatus:true })
  assertEquals(requestedTrendyolPackageLines('packages.split', payload), [{ lineId:'12', quantity:1 }])
  assertThrows(() => normalizeTrendyolSplitPayload({ splitPackages:[{ packageDetails:[] }] }))
})

Deno.test('rejects cross-package and excess quantities before provider calls', () => {
  const available = [{ line_id:'12', quantity:2 }, { line_id:'13', quantity:1 }]
  assertEquals(trendyolPackageLinesAreAvailable([{ lineId:'12', quantity:2 }], available), true)
  assertEquals(trendyolPackageLinesAreAvailable([{ lineId:'12', quantity:3 }], available), false)
  assertEquals(trendyolPackageLinesAreAvailable([{ lineId:'99', quantity:1 }], available), false)
})
