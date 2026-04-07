// app/api/upload-excel/route.js
import { supabaseAdmin } from '../../../lib/supabase'

export async function POST(request) {
  try {
    const { productos, ventas, compras, anio } = await request.json()

    if (!productos?.length) {
      return Response.json({ error: 'No se recibieron productos' }, { status: 400 })
    }

    const db = supabaseAdmin()
    const BATCH = 500

    // 1. Upsert productos del catálogo (Hoja2)
    for (let i = 0; i < productos.length; i += BATCH) {
      const { error } = await db.from('productos')
        .upsert(productos.slice(i, i + BATCH), { onConflict: 'sku' })
      if (error) throw error
    }

    // 2. Detectar SKUs en ventas/compras que no tienen ficha en productos
    //    → insertarlos como "sin catalogar" para no romper el foreign key
    const skusCatalogo = new Set(productos.map(p => p.sku))
    const todosSkusVentas = new Set([
      ...(ventas  || []).map(r => r.sku),
      ...(compras || []).map(r => r.sku),
    ])

    const sinCatalogo = [...todosSkusVentas]
      .filter(sku => !skusCatalogo.has(sku))
      .map(sku => ({
        sku,
        tipo:     'SIN CATALOGAR',
        producto: 'Sin nombre — pendiente de completar',
        variante: '',
        marca:    '',
        precio:   0,
        costo_unit: 0,
        margen:   0,
      }))

    // Insertar solo si no existen ya (ignorar si ya están)
    if (sinCatalogo.length > 0) {
      for (let i = 0; i < sinCatalogo.length; i += BATCH) {
        const { error } = await db.from('productos')
          .upsert(sinCatalogo.slice(i, i + BATCH), {
            onConflict: 'sku',
            ignoreDuplicates: true  // no sobreescribir si ya tienen datos
          })
        if (error) throw error
      }
    }

    // 3. Ahora todos los SKUs existen → insertar ventas y compras sin filtrar
    for (let i = 0; i < (ventas||[]).length; i += BATCH) {
      const { error } = await db.from('ventas_mensuales')
        .upsert(ventas.slice(i, i + BATCH), { onConflict: 'sku,anio,mes' })
      if (error) throw error
    }

    for (let i = 0; i < (compras||[]).length; i += BATCH) {
      const { error } = await db.from('compras_mensuales')
        .upsert(compras.slice(i, i + BATCH), { onConflict: 'sku,anio,mes' })
      if (error) throw error
    }

    return Response.json({
      ok: true,
      productos: productos.length,
      sin_catalogar: sinCatalogo.length,
      ventas: (ventas||[]).length,
      compras: (compras||[]).length,
      anio,
      uploaded_at: new Date().toISOString()
    })
  } catch (err) {
    console.error('[upload-excel]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
