// app/api/dashboard/route.js
// GET /api/dashboard?tab=quiebre|sinmov|todos&q=search&tipo=X&page=1

import { supabase } from '../../../lib/supabase'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const tab   = searchParams.get('tab')   || 'todos'
  const q     = searchParams.get('q')     || ''
  const tipo  = searchParams.get('tipo')  || ''
  const marca = searchParams.get('marca') || ''
  const page  = parseInt(searchParams.get('page') || '1')
  const limit = 50
  const offset = (page - 1) * limit

  try {
    let query = supabase
      .from('dashboard_view')
      .select('*', { count: 'exact' })

    // Filtro por tab
    if (tab === 'quiebre')  query = query.eq('estado', 'QUIEBRE')
    if (tab === 'sinmov')   query = query.eq('estado', 'SIN MOVIMIENTO')

    // Filtros opcionales
    if (tipo)  query = query.eq('tipo', tipo)
    if (marca) query = query.eq('marca', marca)
    if (q) {
      query = query.or(
        `sku.ilike.%${q}%,producto.ilike.%${q}%,variante.ilike.%${q}%,marca.ilike.%${q}%`
      )
    }

    // Ordenar: quiebre por rotación desc, sinmov por costo desc
    if (tab === 'quiebre') query = query.order('rotacion', { ascending: false })
    else if (tab === 'sinmov') query = query.order('stock', { ascending: false })
    else query = query.order('rotacion', { ascending: false })

    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query
    if (error) throw error

    return Response.json({ data, count, page, limit })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
