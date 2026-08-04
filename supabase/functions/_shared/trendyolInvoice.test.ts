import { assertEquals, assertThrows } from 'jsr:@std/assert'
import { decodeTrendyolInvoiceFile } from './trendyolInvoice.ts'

function base64(bytes: number[]) {
  return btoa(String.fromCharCode(...bytes))
}

Deno.test('invoice upload accepts a real PDF signature and preserves package metadata', () => {
  const invoice = decodeTrendyolInvoiceFile({
    shipmentPackageId: 123456,
    fileName: '../فاتورة-123.pdf',
    contentType: 'application/pdf',
    dataBase64: base64([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x37]),
    invoiceNumber: 'ABC2026000000001',
    invoiceDateTime: '1767225600',
  })

  assertEquals(invoice.shipmentPackageId, '123456')
  assertEquals(invoice.fileName, 'فاتورة-123.pdf')
  assertEquals(invoice.contentType, 'application/pdf')
  assertEquals(invoice.bytes.length, 8)
})

Deno.test('invoice upload rejects spoofed content and oversized files', () => {
  assertThrows(() => decodeTrendyolInvoiceFile({
    shipmentPackageId: '123', fileName: 'invoice.pdf', contentType: 'application/pdf',
    dataBase64: base64([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
  }), Error, 'لا يطابق')

  assertThrows(() => decodeTrendyolInvoiceFile({
    shipmentPackageId: '123', fileName: 'invoice.pdf', contentType: 'application/pdf',
    dataBase64: base64([0x25,0x50,0x44,0x46,0x2d]),
  }, 4), Error, 'يتجاوز')
})

Deno.test('invoice upload rejects invalid micro-export invoice metadata', () => {
  assertThrows(() => decodeTrendyolInvoiceFile({
    shipmentPackageId: '123', fileName: 'invoice.pdf', contentType: 'application/pdf',
    dataBase64: base64([0x25,0x50,0x44,0x46]), invoiceNumber: 'SHORT',
  }), Error, '16 خانة')
})
