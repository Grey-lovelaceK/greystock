// app/api/dlds-stock/route.js
// Autentica en Defontana y retorna mapa productCode→currentStock (paginado completo)

const BASE     = process.env.DLDS_API_BASE_URL || 'https://api.defontana.com'
const EMAIL    = process.env.DLDS_EMAIL
const PASS     = process.env.DLDS_PASSWORD
const CLIENT   = process.env.DLDS_CLIENT_ID
const COMPANY  = process.env.DLDS_COMPANY_ID
const USER_ID  = process.env.DLDS_USER_ID

export async function GET() {
  if (!EMAIL || !PASS) {
    return Response.json(
      { error: 'Defontana no configurado. Agregar DLDS_EMAIL y DLDS_PASSWORD en env.' },
      { status: 503 }
    )
  }

  try {
    // 1. Auth → bearer token
    const authUrl = new URL(`${BASE}/api/Auth/EmailLogin`)
    authUrl.searchParams.set('email',    EMAIL)
    authUrl.searchParams.set('password', PASS)
    if (CLIENT)  authUrl.searchParams.set('client',  CLIENT)
    if (COMPANY) authUrl.searchParams.set('company', COMPANY)
    if (USER_ID) authUrl.searchParams.set('user',    USER_ID)

    const authRes = await fetch(authUrl.toString())
    if (!authRes.ok) {
      const txt = await authRes.text()
      throw new Error(`Auth falló (${authRes.status}): ${txt.substring(0, 300)}`)
    }
    const authData = await authRes.json()
    const token =
      authData?.token ||
      authData?.access_token ||
      authData?.bearerToken ||
      authData?.data?.token ||
      authData?.result?.token ||
      authData?.accessToken ||
      authData?.authResult?.access_token

    if (!token) {
      return Response.json({
        error: 'Auth OK pero sin token. Ver auth_response para depurar.',
        auth_response: authData,
      }, { status: 502 })
    }

    // 2. Traer stock completo paginado — /api/Inventory/GetFutureStockInfo
    const stockMap = {}
    const PAGE_SIZE = 500
    let page = 0
    let totalItems = null

    while (true) {
      const url = new URL(`${BASE}/api/Inventory/GetFutureStockInfo`)
      url.searchParams.set('ItemsPerPage', PAGE_SIZE)
      url.searchParams.set('Page', page)

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(`GetFutureStockInfo falló (${res.status}): ${txt.substring(0, 300)}`)
      }
      const data = await res.json()

      if (totalItems === null) {
        totalItems = data.totalItems ?? 0
      }

      const items = data.productsDetail || []
      for (const item of items) {
        const sku   = String(item.productCode || '').trim()
        const stock = Number(item.currentStock ?? 0)
        if (sku) stockMap[sku] = stock
      }

      // ¿Hay más páginas?
      if (!items.length || Object.keys(stockMap).length >= totalItems) break
      page++
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
