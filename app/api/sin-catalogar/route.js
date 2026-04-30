// app/api/sin-catalogar/route.js
import { supabase } from '../../../lib/supabase'
import { supabaseAdmin } from '../../../lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('productos')
    .select('sku, tipo, producto, variante, marca, precio, costo_unit, margen')
    .eq('tipo', 'SIN CATALOGAR')
    .order('sku')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ data, count: data?.length || 0 })
}

export async function POST(request) {
  try {
    const { sku, tipo, producto, variante, marca, precio, costo_unit, margen } = await request.json()
    if (!sku) return Response.json({ error: 'SKU requerido' }, { status: 400 })

    const db = supabaseAdmin()
    const { error } = await db.from('productos')
      .update({ tipo, producto, variante, marca, precio: parseFloat(precio)||0, costo_unit: parseFloat(costo_unit)||0, margen: parseFloat(margen)||0 })
      .eq('sku', sku)

    if (error) throw error
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
