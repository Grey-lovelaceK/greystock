// app/api/kpis/route.js
import { supabase } from '../../../lib/supabase'

export async function GET() {
  try {
    const [quiebre, sinmov, todos] = await Promise.all([
      supabase.from('dashboard_view').select('*', { count: 'exact', head: true }).in('estado', ['QUIEBRE', 'NUEVO']),
      supabase.from('dashboard_view').select('*', { count: 'exact', head: true }).eq('estado', 'SIN MOVIMIENTO'),
      supabase.from('dashboard_view').select('ventas_12m,monto_12m,stock,costo_unit'),
    ])

    const totalVentas = (todos.data || []).reduce((s, r) => s + (r.monto_12m || 0), 0)
    const invParalizada = (todos.data || [])
      .filter(r => r.stock > 0)
      .reduce((s, r) => s + (r.stock * r.costo_unit), 0)

    const { data: syncData } = await supabase
      .from('stock_actual')
      .select('synced_at')
      .order('synced_at', { ascending: false })
      .limit(1)

    return Response.json({
      quiebres:        quiebre.count || 0,
      sin_movimiento:  sinmov.count  || 0,
      ventas_12m:      totalVentas,
      inv_paralizada:  invParalizada,
      last_sync:       syncData?.[0]?.synced_at || null,
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
