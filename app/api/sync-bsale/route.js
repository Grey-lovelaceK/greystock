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

    // 1. SKUs existentes en productos
    const { data: existingProds } = await db.from('productos').select('sku, tipo')
    const validSkus    = new Set((existingProds || []).map(r => r.sku))
    const sinCatActual = new Set((existingProds || []).filter(r => r.tipo === 'SIN CATALOGAR').map(r => r.sku))

    // 2. SKUs de Bsale sin ficha → insertar con nombre real si lo tenemos
    const rowMap = {}
    for (const r of rows) {
      // Deduplicar sumando stock por sku
      if (!rowMap[r.sku]) {
        rowMap[r.sku] = { ...r }
      } else {
        rowMap[r.sku].stock            += r.stock            || 0
        rowMap[r.sku].stock_reservado  += r.stock_reservado  || 0
        rowMap[r.sku].stock_disponible += r.stock_disponible || 0
      }
    }
    const rowsUniq = Object.values(rowMap)

    // SKUs que no existen en productos
    const sinCatalogo = rowsUniq
      .filter(r => !validSkus.has(r.sku))
      .map(r => ({
        sku:       r.sku,
        tipo:      'SIN CATALOGAR',
        producto:  r._nombre || 'Sin nombre — pendiente de completar',
        variante:  r._nombre || '',
        marca:     r._marca  || '',
        precio:    0, costo_unit: 0, margen: 0,
      }))

    // SKUs que ya son SIN CATALOGAR pero ahora tenemos su nombre → actualizar
    const paraActualizar = rowsUniq
      .filter(r => sinCatActual.has(r.sku) && r._nombre)
      .map(r => ({
        sku:     r.sku,
        producto: r._nombre,
        variante: r._nombre,
        marca:    r._marca || '',
      }))

    const BATCH = 500

    // Insertar nuevos SIN CATALOGAR
    if (sinCatalogo.length > 0) {
      const sinCatDedup = Object.values(Object.fromEntries(sinCatalogo.map(p => [p.sku, p])))
      for (let i = 0; i < sinCatDedup.length; i += BATCH) {
        const { error } = await db.from('productos')
          .upsert(sinCatDedup.slice(i, i + BATCH), { onConflict: 'sku', ignoreDuplicates: true })
        if (error) throw error
      }
    }

    // Actualizar nombres de los que ya existían sin nombre
    for (const p of paraActualizar) {
      await db.from('productos')
        .update({ producto: p.producto, variante: p.variante, marca: p.marca })
        .eq('sku', p.sku)
        .eq('tipo', 'SIN CATALOGAR')  // solo si siguen sin catalogar
    }

    // 3. Limpiar campos internos antes de guardar stock
    const stockRows = rowsUniq.map(({ _nombre, _marca, ...rest }) => rest)

    // 4. Upsert stock
    let inserted = 0
    for (let i = 0; i < stockRows.length; i += BATCH) {
      const { error } = await db.from('stock_actual')
        .upsert(stockRows.slice(i, i + BATCH), { onConflict: 'sku' })
      if (error) throw error
      inserted += stockRows.slice(i, i + BATCH).length
    }

    return Response.json({
      ok: true,
      rows_upserted: inserted,
      sin_catalogar_nuevos: sinCatalogo.length,
      nombres_completados: paraActualizar.length,
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
