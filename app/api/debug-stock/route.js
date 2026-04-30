// app/api/debug-stock/route.js — temporal: ver qué oficinas tienen stock de un SKU
const BSALE_BASE  = 'https://api.bsale.io/v1'
const BSALE_TOKEN = process.env.NEXT_PUBLIC_BSALE_TOKEN

export async function GET(request) {
  const sku = new URL(request.url).searchParams.get('sku')
  if (!sku) return Response.json({ error: 'Falta ?sku=...' }, { status: 400 })

  // 1. Buscar variant_id por SKU
  let variantId = null
  let offset = 0
  while (true) {
    const r = await fetch(`${BSALE_BASE}/variants.json?limit=50&offset=${offset}&state=0`, {
      headers: { access_token: BSALE_TOKEN }
    })
    const d = await r.json()
    if (!d.items?.length) break
    const found = d.items.find(v => v.code === sku)
    if (found) { variantId = found.id; break }
    if (d.items.length < 50) break
    offset += 50
  }

  if (!variantId) return Response.json({ error: `SKU ${sku} no encontrado en Bsale` }, { status: 404 })

  // 2. Traer todos los stocks de esa variante
  const stocks = []
  offset = 0
  while (true) {
    const r = await fetch(`${BSALE_BASE}/stocks.json?limit=50&offset=${offset}&variantid=${variantId}`, {
      headers: { access_token: BSALE_TOKEN }
    })
    const d = await r.json()
    if (!d.items?.length) break
    for (const s of d.items) {
      const officeId = parseInt(s.office?.id || s.office?.href?.split('/').pop())
      stocks.push({
        office_id:  officeId,
        quantity:          s.quantity,
        quantityReserved:  s.quantityReserved,
        quantityAvailable: s.quantityAvailable,
      })
    }
    if (d.items.length < 50) break
    offset += 50
  }

  return Response.json({ sku, variant_id: variantId, stocks })
}
