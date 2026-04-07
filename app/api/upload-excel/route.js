// app/api/upload-excel/route.js
// Recibe JSON con productos/ventas/compras ya parseados desde el cliente
// El cliente usa xlsx.js para parsear — evita el límite de 4.5mb de Vercel

import { supabaseAdmin } from '../../../lib/supabase'

export async function POST(request) {
  try {
    const { productos, ventas, compras, anio } = await request.json()

    if (!productos?.length) {
      return Response.json({ error: 'No se recibieron productos' }, { status: 400 })
    }

    const db = supabaseAdmin()
    const BATCH = 500

    // 1. Upsert productos
    for (let i = 0; i < productos.length; i += BATCH) {
      const { error } = await db.from('productos')
        .upsert(productos.slice(i, i + BATCH), { onConflict: 'sku' })
      if (error) throw error
    }

    // 2. Upsert ventas
    for (let i = 0; i < ventas.length; i += BATCH) {
      const { error } = await db.from('ventas_mensuales')
        .upsert(ventas.slice(i, i + BATCH), { onConflict: 'sku,anio,mes' })
      if (error) throw error
    }

    // 3. Upsert compras
    for (let i = 0; i < compras.length; i += BATCH) {
      const { error } = await db.from('compras_mensuales')
        .upsert(compras.slice(i, i + BATCH), { onConflict: 'sku,anio,mes' })
      if (error) throw error
    }

    return Response.json({
      ok: true,
      productos: productos.length,
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
