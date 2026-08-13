export type CatalogProductIdentity = {
  id: string
  name: string
  name_en?: string | null
  sku?: string | null
  barcode?: string | null
  psku_code?: string | null
  noon_sku_child?: string | null
  asin?: string | null
  external_id?: string | null
  supplier_sku?: string | null
  model_code?: string | null
}

export type CatalogChannelMapping = {
  product_id?: string | null
  platform?: string | null
  identifier_value?: string | null
  source_sku?: string | null
  source_barcode?: string | null
  source_name?: string | null
  match_status?: string | null
}

export type CatalogLookup = {
  platform?: string | null
  identifiers?: Array<string | null | undefined>
  sourceName?: string | null
}

const compact = (value?: string | null) => String(value || '').trim().toLocaleLowerCase('en-US')
const compactName = (value?: string | null) => compact(value).replace(/[\s\p{P}\p{S}]+/gu, '')

function addAlias(map: Map<string, CatalogProductIdentity>, value: string | null | undefined, product: CatalogProductIdentity) {
  const key = compact(value)
  if (key && !map.has(key)) map.set(key, product)
}

export function createCatalogResolver(products: CatalogProductIdentity[], mappings: CatalogChannelMapping[] = []) {
  const productById = new Map(products.map(product => [product.id, product]))
  const byIdentifier = new Map<string, CatalogProductIdentity>()
  const byName = new Map<string, CatalogProductIdentity>()

  for (const product of products) {
    for (const value of [product.sku, product.barcode, product.psku_code, product.noon_sku_child, product.asin, product.external_id, product.supplier_sku, product.model_code]) {
      addAlias(byIdentifier, value, product)
    }
    for (const value of [product.name, product.name_en]) {
      const key = compactName(value)
      if (key && !byName.has(key)) byName.set(key, product)
    }
  }

  for (const mapping of mappings) {
    if (mapping.match_status && mapping.match_status !== 'linked') continue
    const product = mapping.product_id ? productById.get(mapping.product_id) : undefined
    if (!product) continue
    for (const value of [mapping.identifier_value, mapping.source_sku, mapping.source_barcode]) addAlias(byIdentifier, value, product)
    const nameKey = compactName(mapping.source_name)
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, product)
  }

  return (lookup: CatalogLookup): CatalogProductIdentity | undefined => {
    for (const identifier of lookup.identifiers || []) {
      const product = byIdentifier.get(compact(identifier))
      if (product) return product
    }
    return byName.get(compactName(lookup.sourceName))
  }
}

