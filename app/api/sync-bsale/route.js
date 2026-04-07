// app/api/sync-bsale/route.js
// Recibe el stock ya procesado desde el cliente y lo guarda en Supabase
// El cliente hace las llamadas a Bsale directamente (evita timeout de Vercel)

import { supabaseAdmin } from '../../../lib/supabase'

export const maxDuration = 60 // Pro plan: 60s. Hobby: ignorado pero no rompe

export async function POST(request) {
  try {
    const body = await request.json()
    const { rows } = body

    if (!rows || !Array.isArray(rows)) {
      return Response.json({ error: 'Se esperaba { rows: [...] }' }, { status: 400 })
    }

    const db = supabaseAdmin()
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
      rows_upserted: inserted,
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
