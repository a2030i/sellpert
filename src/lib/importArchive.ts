export const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024
export const MAX_ARCHIVE_ENTRIES = 100
export const MAX_ARCHIVE_EXPANDED_BYTES = 100 * 1024 * 1024

const CONTENT_TYPES: Record<string, string> = {
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  zip: 'application/zip',
}

export function importFileExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() || ''
}

export function importArchiveContentType(fileName: string) {
  return CONTENT_TYPES[importFileExtension(fileName)] || 'application/octet-stream'
}

export function safeImportArchiveName(fileName: string) {
  const base = fileName.split(/[\\/]/).pop() || 'source-file'
  const cleaned = base.normalize('NFKC').replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/\s+/g, '-').replace(/-+/g, '-').slice(-120)
  return cleaned || 'source-file'
}

export function importArchivePath(merchantCode: string, uploadId: string, fileName: string) {
  const merchant = merchantCode.replace(/[^A-Z0-9-]/gi, '')
  const id = uploadId.replace(/[^a-f0-9-]/gi, '')
  if (!merchant || !id) throw new Error('تعذر إنشاء مسار آمن للملف')
  return `${merchant}/${id}/${safeImportArchiveName(fileName)}`
}

export function validateImportFile(file: Pick<File, 'name' | 'size'>) {
  const extension = importFileExtension(file.name)
  if (!Object.prototype.hasOwnProperty.call(CONTENT_TYPES, extension)) return 'الصيغة غير مدعومة. استخدم CSV أو Excel أو ZIP.'
  if (file.size <= 0) return 'الملف فارغ.'
  if (file.size > MAX_IMPORT_FILE_BYTES) return 'حجم الملف يتجاوز الحد الأقصى 25MB.'
  return null
}
