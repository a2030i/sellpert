import JSZip from 'jszip'

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

export async function expandImportArchive(file: File): Promise<File[]> {
  const fileError = validateImportFile(file)
  if (fileError) throw new Error(fileError)

  const looksLikeZipByName = /\.zip$/i.test(file.name)
  const buffer = await file.arrayBuffer()
  const signature = new Uint8Array(buffer.slice(0, 4))
  const looksLikeZipByContent = signature[0] === 0x50
    && signature[1] === 0x4b
    && (signature[2] === 0x03 || signature[2] === 0x05)
    && (signature[3] === 0x04 || signature[3] === 0x06)

  // Excel workbooks use the same container signature and must remain intact.
  if (/\.(xlsx|xlsm|xltx)$/i.test(file.name)) return [file]
  if (!looksLikeZipByName && !looksLikeZipByContent) return [file]

  let archive: JSZip
  try {
    archive = await JSZip.loadAsync(buffer)
  } catch {
    throw new Error('ملف ZIP غير صالح أو تالف.')
  }

  const files: File[] = []
  let expandedBytes = 0
  for (const entry of Object.values(archive.files)) {
    if (entry.dir || !/\.(csv|xlsx|xlsm|xls|txt|tsv)$/i.test(entry.name)) continue
    if (files.length >= MAX_ARCHIVE_ENTRIES) throw new Error(`ملف ZIP يحتوي أكثر من ${MAX_ARCHIVE_ENTRIES} ملف صالح`)

    const estimatedSize = Number((entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0)
    if (estimatedSize > MAX_IMPORT_FILE_BYTES) throw new Error(`الملف «${entry.name}» داخل ZIP يتجاوز 25MB`)
    if (expandedBytes + estimatedSize > MAX_ARCHIVE_EXPANDED_BYTES) throw new Error('الحجم الإجمالي بعد فك ZIP يتجاوز 100MB')

    const blob = await entry.async('blob')
    if (blob.size > MAX_IMPORT_FILE_BYTES) throw new Error(`الملف «${entry.name}» داخل ZIP يتجاوز 25MB`)
    expandedBytes += blob.size
    if (expandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) throw new Error('الحجم الإجمالي بعد فك ZIP يتجاوز 100MB')

    const cleanName = entry.name.split('/').pop() || entry.name
    files.push(new File([blob], cleanName, { type: blob.type }))
  }

  if (!files.length) throw new Error('ملف ZIP لا يحتوي تقارير مدعومة.')
  return files
}
