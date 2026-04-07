// app/api/filters/route.js
import { supabase } from '../../../lib/supabase'

export async function GET() {
  const [tipos, marcas] = await Promise.all([
    supabase.from('productos').select('tipo').not('tipo', 'is', null).order('tipo'),
    supabase.from('productos').select('marca').not('marca', 'is', null).order('marca'),
  ])

  const uniqueTipos  = [...new Set((tipos.data  || []).map(r => r.tipo).filter(Boolean))].sort()
  const uniqueMarcas = [...new Set((marcas.data || []).map(r => r.marca).filter(Boolean))].sort()

  return Response.json({ tipos: uniqueTipos, marcas: uniqueMarcas })
}
