// app/api/sync-bsale/route.js
import { supabaseAdmin } from '../../../lib/supabase'

export const maxDuration = 60

export async function POST(request) {
  try {
    const body = await request.json()
    const { rows } = body

    if (!rows || !Array.isArray(rows)) {
      return Response.json({ error: 'Se esperaba { rows: [...] }' }, { status: 400 })
    }

    const db = supabaseAdmin()

    // 1. Obtener SKUs existentes en productos
    const { data: existingProds } = await db.from('productos').select('sku')
    const validSkus = new Set((existingProds || []).map(r => r.sku))

    // 2. Detectar SKUs de Bsale que no están en productos → insertar como SIN CATALOGAR
    const sinCatalogo = rows
      .filter(r => !validSkus.has(r.sku))
      .map(r => ({
        sku: r.sku,
        tipo: 'SIN CATALOGAR',
        producto: 'Sin nombre — pendiente de completar',
        variante: '', marca: '', precio: 0, costo_unit: 0, margen: 0,
      }))

    // Deduplicar por sku
    const sinCatMap = {}
    for (const p of sinCatalogo) sinCatMap[p.sku] = p
    const sinCatUniq = Object.values(sinCatMap)

    if (sinCatUniq.length > 0) {
      const BATCH = 500
      for (let i = 0; i < sinCatUniq.length; i += BATCH) {
        const { error } = await db.from('productos')
          .upsert(sinCatUniq.slice(i, i + BATCH), { onConflict: 'sku', ignoreDuplicates: true })
        if (error) throw error
      }
    }

    // 3. Deduplicar rows por sku (sumar si hay múltiples sucursales)
    const rowMap = {}
    for (const r of rows) {
      if (!rowMap[r.sku]) {
        rowMap[r.sku] = { ...r }
      } else {
        rowMap[r.sku].stock            += r.stock
        rowMap[r.sku].stock_reservado  += r.stock_reservado
        rowMap[r.sku].stock_disponible += r.stock_disponible
      }
    }
    const rowsUniq = Object.values(rowMap)

    // 4. Upsert stock
    const BATCH = 500
    let inserted = 0
    for (let i = 0; i < rowsUniq.length; i += BATCH) {
      const { error } = await db.from('stock_actual')
        .upsert(rowsUniq.slice(i, i + BATCH), { onConflict: 'sku' })
      if (error) throw error
      inserted += rowsUniq.slice(i, i + BATCH).length
    }

    return Response.json({
      ok: true,
      rows_upserted: inserted,
      sin_catalogar: sinCatUniq.length,
      synced_at: new Date().toISOString()
    })
  } catch (err) {
    console.error('[sync-bsale] Error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function GET() {
  try {
    const db = supabaseAdmin()
    const { data } = await db
      .from('stock_actual')
      .select('synced_at')
      .order('synced_at', { ascending: false })
      .limit(1)
    return Response.json({ last_sync: data?.[0]?.synced_at || null })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
