export type TrendyolOption = { id: number; name: string }
export type TrendyolCategoryOption = TrendyolOption & { path: string }
export type TrendyolAttribute = TrendyolOption & {
  required: boolean
  allowCustom: boolean
  allowMultiple: boolean
  values: TrendyolOption[]
}
export type TrendyolAddress = TrendyolOption & { type: 'shipment' | 'return' | 'invoice' }

function arrayFrom(value: any, keys: string[]) {
  if (Array.isArray(value)) return value
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key]
  return []
}

function option(value: any, idKeys: string[], nameKeys: string[]): TrendyolOption | null {
  const id = Number(idKeys.map(key => value?.[key]).find(candidate => candidate !== undefined))
  const name = String(nameKeys.map(key => value?.[key]).find(candidate => candidate) || '').trim()
  return Number.isInteger(id) && id > 0 && name ? { id, name } : null
}

export function parseTrendyolBrands(raw: any): TrendyolOption[] {
  const values = arrayFrom(raw, ['brands', 'content', 'items', 'data'])
  const candidates = values.length ? values : [raw?.brand, raw]
  return candidates
    .map(value => option(value, ['id', 'brandId'], ['name', 'brandName']))
    .filter((value): value is TrendyolOption => Boolean(value))
}

export function flattenTrendyolCategories(raw: any): TrendyolCategoryOption[] {
  const roots = arrayFrom(raw, ['categories', 'content', 'items', 'data'])
  const result: TrendyolCategoryOption[] = []
  const visit = (value: any, parents: string[]) => {
    const current = option(value, ['id', 'categoryId'], ['name', 'displayName', 'categoryName'])
    if (!current) return
    const children = arrayFrom(value, ['subCategories', 'children', 'categories'])
    const names = [...parents, current.name]
    if (children.length) children.forEach(child => visit(child, names))
    else result.push({ ...current, path:names.join(' ← ') })
  }
  roots.forEach(root => visit(root, []))
  return result
}

export function parseTrendyolAttributes(raw: any): TrendyolAttribute[] {
  return arrayFrom(raw, ['categoryAttributes', 'content', 'attributes', 'items', 'data']).map(value => {
    const base = option(value?.attribute || value, ['id', 'attributeId'], ['name', 'attributeName'])
    if (!base) return null
    const values = arrayFrom(value, ['attributeValues', 'values', 'content'])
      .map(candidate => option(candidate, ['id', 'attributeValueId'], ['name', 'attributeValue']))
      .filter((candidate): candidate is TrendyolOption => Boolean(candidate))
    return {
      ...base,
      required:Boolean(value?.required),
      allowCustom:Boolean(value?.allowCustom),
      allowMultiple:Boolean(value?.allowMultipleAttributeValues),
      values,
    }
  }).filter((value): value is TrendyolAttribute => Boolean(value))
}

export function parseTrendyolAttributeValues(raw: any): TrendyolOption[] {
  return arrayFrom(raw, ['content', 'attributeValues', 'values', 'items', 'data'])
    .map(value => option(value, ['attributeValueId', 'id'], ['attributeValue', 'name']))
    .filter((value): value is TrendyolOption => Boolean(value))
}

export function parseTrendyolAddresses(raw: any): TrendyolAddress[] {
  const groups: Array<{ type: TrendyolAddress['type']; keys: string[] }> = [
    { type:'shipment', keys:['shipmentAddresses', 'shippingAddresses', 'supplierAddresses'] },
    { type:'return', keys:['returningAddresses', 'returnAddresses'] },
    { type:'invoice', keys:['invoiceAddresses'] },
  ]
  const result: TrendyolAddress[] = []
  for (const group of groups) {
    for (const value of arrayFrom(raw, group.keys)) {
      const id = Number(value?.id ?? value?.addressId)
      const parts = [value?.name, value?.addressName, value?.fullAddress, value?.address, value?.district, value?.city]
        .map(part => String(part || '').trim()).filter(Boolean)
      if (Number.isInteger(id) && id > 0) result.push({ id, name:[...new Set(parts)].join('، ') || `عنوان ${result.length + 1}`, type:group.type })
    }
  }
  for (const value of arrayFrom(raw, ['addresses', 'content', 'items'])) {
    const typeValue = String(value?.addressType || value?.type || '').toLowerCase()
    const type: TrendyolAddress['type'] = typeValue.includes('return') ? 'return' : typeValue.includes('invoice') ? 'invoice' : 'shipment'
    const id = Number(value?.id ?? value?.addressId)
    const name = [value?.name, value?.addressName, value?.fullAddress, value?.address, value?.district, value?.city]
      .map(part => String(part || '').trim()).filter(Boolean).filter((part, index, parts) => parts.indexOf(part) === index).join('، ')
    if (Number.isInteger(id) && id > 0 && !result.some(address => address.id === id && address.type === type)) result.push({ id, name:name || `عنوان ${result.length + 1}`, type })
  }
  return result
}
