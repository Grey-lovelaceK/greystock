// app/api/upload-excel/route.js
import { supabaseAdmin } from '../../../lib/supabase'

function dedup(arr, keyFn) {
  const map = {}
  for (const item of arr) map[keyFn(item)] = item
  return Object.values(map)
}

export async function POST(request) {
  try {
    let { productos, ventas, compras, anio } = await request.json()

    if (!productos?.length) {
      return Response.json({ error: 'No se recibieron productos' }, { status: 400 })
    }

    // Deduplicar por si acaso vienen duplicados del cliente
    productos = dedup(productos, p => p.sku)
    ventas    = dedup(ventas    || [], v => `${v.sku}_${v.mes}`)
    compras   = dedup(compras   || [], c => `${c.sku}_${c.mes}`)

    const db = supabaseAdmin()
    const BATCH = 500

    // 1. Upsert productos del catálogo (Hoja2)
    for (let i = 0; i < productos.length; i += BATCH) {
      const { error } = await db.from('productos')
        .upsert(productos.slice(i, i + BATCH), { onConflict: 'sku' })
      if (error) throw error
    }

    // 2. SKUs en ventas/compras sin ficha → insertar como "SIN CATALOGAR"
    const skusCatalogo = new Set(productos.map(p => p.sku))
    const todosSkus = new Set([...ventas.map(r => r.sku), ...compras.map(r => r.sku)])
    const sinCatalogo = [...todosSkus]
      .filter(sku => !skusCatalogo.has(sku))
      .map(sku => ({
        sku,
        tipo: 'SIN CATALOGAR',
        producto: 'Sin nombre — pendiente de completar',
        variante: '', marca: '', precio: 0, costo_unit: 0, margen: 0,
      }))

    if (sinCatalogo.length > 0) {
      for (let i = 0; i < sinCatalogo.length; i += BATCH) {
        const { error } = await db.from('productos')
          .upsert(sinCatalogo.slice(i, i + BATCH), { onConflict: 'sku', ignoreDuplicates: true })
        if (error) throw error
      }
    }

    // 3. Upsert ventas y compras
    for (let i = 0; i < ventas.length; i += BATCH) {
      const { error } = await db.from('ventas_mensuales')
        .upsert(ventas.slice(i, i + BATCH), { onConflict: 'sku,anio,mes' })
      if (error) throw error
    }

    for (let i = 0; i < compras.length; i += BATCH) {
      const { error } = await db.from('compras_mensuales')
        .upsert(compras.slice(i, i + BATCH), { onConflict: 'sku,anio,mes' })
      if (error) throw error
    }

    return Response.json({
      ok: true,
      productos: productos.length,
      sin_catalogar: sinCatalogo.length,
      ventas: ventas.length,
      compras: compras.length,
      anio,
      uploaded_at: new Date().toISOString()
    })
  } catch (err) {
    console.error('[upload-excel]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
