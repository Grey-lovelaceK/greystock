// app/api/dlds-stock/route.js
// Autentica en DLDS y retorna mapa sku→stock disponible
// Configurar en .env: DLDS_API_BASE_URL, DLDS_EMAIL, DLDS_PASSWORD, DLDS_CLIENT_ID,
//                     DLDS_COMPANY_ID, DLDS_USER_ID, DLDS_STOCK_PATH

const DLDS_BASE      = process.env.DLDS_API_BASE_URL
const DLDS_EMAIL     = process.env.DLDS_EMAIL
const DLDS_PASS      = process.env.DLDS_PASSWORD
const DLDS_CLIENT    = process.env.DLDS_CLIENT_ID
const DLDS_COMPANY   = process.env.DLDS_COMPANY_ID
const DLDS_USER      = process.env.DLDS_USER_ID
const DLDS_STOCK_PATH = process.env.DLDS_STOCK_PATH || '/api/Product/GetAll'

export async function GET() {
  if (!DLDS_BASE || !DLDS_EMAIL || !DLDS_PASS) {
    return Response.json(
      { error: 'DLDS no configurado. Agregar DLDS_API_BASE_URL, DLDS_EMAIL y DLDS_PASSWORD en .env' },
      { status: 503 }
    )
  }

  try {
    // 1. Autenticar → bearer token
    const authUrl = new URL(`${DLDS_BASE}/api/Auth/EmailLogin`)
    authUrl.searchParams.set('email',    DLDS_EMAIL)
    authUrl.searchParams.set('password', DLDS_PASS)
    if (DLDS_CLIENT)  authUrl.searchParams.set('client',  DLDS_CLIENT)
    if (DLDS_COMPANY) authUrl.searchParams.set('company', DLDS_COMPANY)
    if (DLDS_USER)    authUrl.searchParams.set('user',    DLDS_USER)

    const authRes = await fetch(authUrl.toString(), { method: 'GET' })
    if (!authRes.ok) {
      const txt = await authRes.text()
      throw new Error(`Auth DLDS falló (${authRes.status}): ${txt.substring(0, 200)}`)
    }
    const authData = await authRes.json()
    // Intentar extraer token de varios formatos posibles
    const token =
      authData?.token ||
      authData?.access_token ||
      authData?.bearerToken ||
      authData?.data?.token ||
      authData?.result?.token ||
      authData?.accessToken

    if (!token) {
      return Response.json({
        error: 'Auth OK pero no se encontró token. Revisar formato de respuesta.',
        auth_response: authData,
      }, { status: 502 })
    }

    // 2. Obtener stock/productos desde DLDS
    const stockRes = await fetch(`${DLDS_BASE}${DLDS_STOCK_PATH}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!stockRes.ok) {
      const txt = await stockRes.text()
      throw new Error(`Stock DLDS falló (${stockRes.status}): ${txt.substring(0, 200)}`)
    }
    const stockData = await stockRes.json()

    // 3. Normalizar a array de items
    const rawItems = Array.isArray(stockData)
      ? stockData
      : stockData?.items || stockData?.data || stockData?.result || []

    // 4. Construir mapa sku → stock
    const stockMap = {}
    for (const item of rawItems) {
      const sku = String(
        item.sku || item.SKU || item.codigo || item.Codigo ||
        item.code || item.Code || item.productCode || ''
      ).trim()
      const qty = Number(
        item.stock ?? item.Stock ?? item.quantity ?? item.cantidad ??
        item.stockDisponible ?? item.available ?? 0
      )
      if (sku) stockMap[sku] = qty
    }

    return Response.json({
      ok:    true,
      total: Object.keys(stockMap).length,
      stock: stockMap,
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
