// app/api/sync-bsale/route.js
// POST /api/sync-bsale  →  Descarga todo el stock desde Bsale y actualiza Supabase
// Protegido con CRON_SECRET para llamadas automáticas desde Vercel Cron

import { supabaseAdmin } from '../../../lib/supabase'

const BSALE_TOKEN = process.env.BSALE_ACCESS_TOKEN
const BSALE_BASE  = 'https://api.bsale.io/v1'

async function fetchAllVariants() {
  // Trae todas las variantes con su SKU (code) — paginado de 50 en 50
  const variants = {}
  let offset = 0
  const limit = 50

  while (true) {
    const res = await fetch(`${BSALE_BASE}/variants.json?limit=${limit}&offset=${offset}&state=0`, {
      headers: { access_token: BSALE_TOKEN }
    })
    const data = await res.json()
    if (!data.items || data.items.length === 0) break

    for (const v of data.items) {
      if (v.code) variants[v.id] = v.code  // id → SKU
    }

    if (data.items.length < limit) break
    offset += limit
  }

  console.log(`[bsale] ${Object.keys(variants).length} variantes cargadas`)
  return variants
}

async function fetchAllStocks(variantMap) {
  // Trae todos los stocks y los agrupa por SKU (sumando sucursales)
  const stockBySku = {}
  let offset = 0
  const limit = 50

  while (true) {
    const res = await fetch(`${BSALE_BASE}/stocks.json?limit=${limit}&offset=${offset}`, {
      headers: { access_token: BSALE_TOKEN }
    })
    const data = await res.json()
    if (!data.items || data.items.length === 0) break

    for (const s of data.items) {
      const variantId = parseInt(s.variant?.id || s.variant?.href?.split('/').pop())
      const sku = variantMap[variantId]
      if (!sku) continue

      if (!stockBySku[sku]) {
        stockBySku[sku] = { stock: 0, reservado: 0, disponible: 0, variantId }
      }
      stockBySku[sku].stock      += s.quantity        || 0
      stockBySku[sku].reservado  += s.quantityReserved || 0
      stockBySku[sku].disponible += s.quantityAvailable || 0
    }

    if (data.items.length < limit) break
    offset += limit
  }

  console.log(`[bsale] ${Object.keys(stockBySku).length} SKUs con stock`)
  return stockBySku
}

export async function POST(request) {
  // Validar secret si viene de cron
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const db = supabaseAdmin()

    console.log('[sync-bsale] Iniciando sync...')
    const variantMap  = await fetchAllVariants()
    const stockBySku  = await fetchAllStocks(variantMap)

    // Obtener SKUs existentes en la BD
    const { data: existingSkus } = await db
      .from('productos')
      .select('sku')

    const validSkus = new Set((existingSkus || []).map(r => r.sku))

    // Preparar upserts solo para SKUs que existen en productos
    const rows = Object.entries(stockBySku)
      .filter(([sku]) => validSkus.has(sku))
      .map(([sku, s]) => ({
        sku,
        stock:            s.stock,
        stock_reservado:  s.reservado,
        stock_disponible: s.disponible,
        bsale_variant_id: s.variantId,
        synced_at:        new Date().toISOString()
      }))

    // Upsert en lotes de 500
    const BATCH = 500
    let inserted = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      const { error } = await db.from('stock_actual').upsert(batch, { onConflict: 'sku' })
      if (error) throw error
      inserted += batch.length
    }

    return Response.json({
      ok: true,
      synced_at: new Date().toISOString(),
      variants_bsale: Object.keys(variantMap).length,
      skus_con_stock: Object.keys(stockBySku).length,
      rows_upserted: inserted
    })
  } catch (err) {
    console.error('[sync-bsale] Error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// GET para verificar estado del último sync
export async function GET() {
  const db = supabaseAdmin()
  const { data } = await db
    .from('stock_actual')
    .select('synced_at')
    .order('synced_at', { ascending: false })
    .limit(1)

  return Response.json({
    last_sync: data?.[0]?.synced_at || null,
    message: 'Usar POST para ejecutar sync'
  })
}
