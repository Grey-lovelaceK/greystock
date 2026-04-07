// app/api/upload-excel/route.js
// POST /api/upload-excel  →  Procesa el Excel (BBDD + Hoja2) y carga a Supabase

import { supabaseAdmin } from '@/lib/supabase'
import * as XLSX from 'xlsx'

const MONTHS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC']

function safeNum(v) {
  const n = parseFloat(v)
  return isNaN(n) ? 0 : n
}
function safeStr(v) {
  if (v === null || v === undefined) return ''
  const s = String(v).trim()
  return s === 'NaN' || s === 'undefined' ? '' : s
}

function parseBBDD(workbook) {
  // Hoja BBDD: fila 0 = secciones, fila 1 = col names, filas 2+ = datos
  // Secciones: VENTAS(cols 1-12), COMPRAS(13-24), STOCK(25-36), Rotacion(50)
  const ws = workbook.Sheets['BBDD']
  if (!ws) throw new Error('Hoja BBDD no encontrada')

  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: 0 })
  // raw[0] = section headers, raw[1] = month labels, raw[2+] = data

  const ventas   = []
  const compras  = []
  const anio     = 2024 // año base del histórico — ajustar si cambia

  for (let i = 2; i < raw.length; i++) {
    const row = raw[i]
    const sku = safeStr(row[0])
    if (!sku || sku === 'SKU') continue

    // Ventas mensuales (cols 1-12)
    for (let m = 0; m < 12; m++) {
      const cant = safeNum(row[1 + m])
      if (cant !== 0) {
        ventas.push({ sku, anio, mes: m + 1, cantidad: cant, monto: 0 })
      }
    }

    // Compras mensuales (cols 13-24)
    for (let m = 0; m < 12; m++) {
      const cant = safeNum(row[13 + m])
      if (cant !== 0) {
        compras.push({ sku, anio, mes: m + 1, cantidad: cant, monto: 0 })
      }
    }
  }

  return { ventas, compras }
}

function parseHoja2(workbook) {
  const ws = workbook.Sheets['Hoja2']
  if (!ws) throw new Error('Hoja2 no encontrada')

  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  const productos = []

  for (const row of rows) {
    const sku = safeStr(row['SKU'])
    if (!sku) continue

    productos.push({
      sku,
      tipo:        safeStr(row['Tipo de Producto']),
      producto:    safeStr(row['Producto']),
      variante:    safeStr(row['Variante']),
      marca:       safeStr(row['Marca']),
      categoria:   '',
      subcategoria:'',
      precio:      safeNum(row['Precio Venta Bruto']),
      costo_unit:  safeNum(row['Costo Neto Prom. Unitario']),
      margen:      safeNum(row['Margen Unitario']),
    })
  }

  return productos
}

export async function POST(request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    const anioParam = formData.get('anio')   // año del Excel que se sube

    if (!file) return Response.json({ error: 'No se recibió archivo' }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer' })

    const db = supabaseAdmin()

    // 1. Parsear productos desde Hoja2
    const productos = parseHoja2(workbook)
    console.log(`[upload] ${productos.length} productos desde Hoja2`)

    // 2. Upsert productos
    const BATCH = 500
    for (let i = 0; i < productos.length; i += BATCH) {
      const { error } = await db.from('productos')
        .upsert(productos.slice(i, i + BATCH), { onConflict: 'sku' })
      if (error) throw error
    }

    // 3. Parsear ventas y compras desde BBDD
    const { ventas, compras } = parseBBDD(workbook)

    // Sobrescribir año si viene en el form
    const anio = parseInt(anioParam) || 2024
    ventas.forEach(r => r.anio = anio)
    compras.forEach(r => r.anio = anio)

    console.log(`[upload] ${ventas.length} filas ventas, ${compras.length} filas compras`)

    // 4. Upsert ventas
    for (let i = 0; i < ventas.length; i += BATCH) {
      const { error } = await db.from('ventas_mensuales')
        .upsert(ventas.slice(i, i + BATCH), { onConflict: 'sku,anio,mes' })
      if (error) throw error
    }

    // 5. Upsert compras
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
    console.error('[upload-excel] Error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
