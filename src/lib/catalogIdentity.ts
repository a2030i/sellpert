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
  marketplace_account_id?: string | null
  platform?: string | null
  identifier_value?: string | null
  source_sku?: string | null
  source_barcode?: string | null
  source_name?: string | null
  match_status?: string | null
}

export type CatalogLookup = {
  marketplace_account_id?: string | null
  platform?: string | null
  identifiers?: Array<string | null | undefined>
  sourceName?: string | null
}

// External identifiers are opaque and case-sensitive. Names and family/model
// codes are suggestions only: they cannot establish sellable-variant identity.
const compact = (value?: string | null) => String(value || '').trim()
type AliasIndex = Map<string, CatalogProductIdentity | null>
function addAlias(map: AliasIndex, key: string, product: CatalogProductIdentity) {
  if (!key) return
  const previous = map.get(key)
  map.set(key, previous === undefined || previous?.id === product.id ? product : null)
}
const scopedKey = (account: string | null | undefined, platform: string | null | undefined, value: string) => JSON.stringify([account || '', platform || '', value])

export function createCatalogResolver(products: CatalogProductIdentity[], mappings: CatalogChannelMapping[] = []) {
  const productById = new Map(products.map(product => [product.id, product]))
  const canonical: AliasIndex = new Map()
  const scoped: AliasIndex = new Map()
  for (const product of products) {
    for (const value of [product.sku, product.barcode]) addAlias(canonical, compact(value), product)
    for (const [platform, values] of [['noon', [product.psku_code, product.noon_sku_child]], ['amazon', [product.asin]]] as const) {
      for (const value of values) if (compact(value)) addAlias(scoped, scopedKey(null, platform, compact(value)), product)
    }
  }
  for (const mapping of mappings) {
    if (mapping.match_status !== 'linked') continue
    const product = mapping.product_id ? productById.get(mapping.product_id) : undefined
    if (!product) continue
    for (const value of [mapping.identifier_value, mapping.source_sku, mapping.source_barcode]) {
      if (compact(value)) addAlias(scoped, scopedKey(mapping.marketplace_account_id, mapping.platform, compact(value)), product)
    }
  }
  return (lookup: CatalogLookup): CatalogProductIdentity | undefined => {
    const candidates = new Map<string, CatalogProductIdentity>()
    for (const value of lookup.identifiers || []) {
      const identifier = compact(value)
      if (!identifier) continue
      const key = scopedKey(lookup.marketplace_account_id, lookup.platform, identifier)
      // An explicit account never falls back to another/legacy account's alias.
      const match = scoped.has(key) ? scoped.get(key)
        : lookup.marketplace_account_id ? undefined : canonical.get(identifier)
      if (match === null) return undefined
      if (match) candidates.set(match.id, match)
    }
    return candidates.size === 1 ? [...candidates.values()][0] : undefined
  }
}
