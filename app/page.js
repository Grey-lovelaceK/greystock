'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import styles from './page.module.css'

// Token público de Bsale — se inyecta en build time por Vercel
const BSALE_TOKEN = process.env.NEXT_PUBLIC_BSALE_TOKEN
const BSALE_BASE  = 'https://api.bsale.io/v1'
const MONTHS_SHORT = ['E','F','M','A','M','J','J','A','S','O','N','D']

function fmtClp(n) {
  if (!n) return '—'
  if (n >= 1e9) return '$' + (n/1e9).toFixed(1) + 'B'
  if (n >= 1e6) return '$' + (n/1e6).toFixed(1) + 'M'
  if (n >= 1e3) return '$' + (n/1e3).toFixed(0) + 'K'
  return '$' + Math.round(n).toLocaleString('es-CL')
}

function SparkBars({ ventas }) {
  if (!ventas) return null
  const vals = Object.values(ventas).map(Number)
  const mx = Math.max(...vals, 1)
  return (
    <div style={{ display:'flex', gap:2, alignItems:'flex-end', height:24 }}>
      {vals.map((v, i) => (
        <div key={i} style={{
          width:5, borderRadius:'2px 2px 0 0', minHeight:2,
          height: Math.round((v/mx)*22)+2,
          background: v > 0 ? 'var(--accent)' : 'var(--border)'
        }} />
      ))}
    </div>
  )
}

function DetailPanel({ sku, onClose }) {
  const [item, setItem] = useState(null)
  useEffect(() => {
    if (!sku) return
    fetch(`/api/dashboard?tab=todos&q=${sku}&page=1`)
      .then(r => r.json())
      .then(d => setItem(d.data?.[0] || null))
  }, [sku])

  if (!sku) return null
  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.panel}>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>
        {!item ? (
          <div style={{ color:'var(--muted)', fontFamily:"'DM Mono',monospace", fontSize:12 }}>Cargando...</div>
        ) : (
          <>
            <div className={styles.detailSku}>{item.sku} · {item.tipo}</div>
            <div className={styles.detailName}>{item.producto}</div>
            <div className={styles.detailVar}>{item.variante}{item.marca ? ` · ${item.marca}` : ''}</div>
            <div style={{ marginBottom:16 }}>
              {item.estado === 'QUIEBRE'
                ? <span className={`${styles.pill} ${styles.pillRed}`}>⚠ QUIEBRE — COMPRAR URGENTE</span>
                : <span className={`${styles.pill} ${styles.pillAmber}`}>○ SIN MOVIMIENTO — REMATAR</span>
              }
            </div>
            <div className={styles.detailGrid}>
              {[
                { label:'Stock Actual',  value: item.stock,                                              color: item.stock===0?'var(--red)':'var(--green)' },
                { label:'Rotación',      value: Number(item.rotacion||0).toFixed(2),                    color: item.rotacion>10?'var(--green)':item.rotacion>2?'var(--amber)':'var(--muted)' },
                { label:'Ventas 12m',    value: Number(item.ventas_12m||0).toLocaleString('es-CL'),     color:'var(--text)' },
                { label:'Precio Venta',  value: fmtClp(item.precio),                                    color:'var(--text)' },
                { label:'Costo Unit.',   value: fmtClp(item.costo_unit),                                color:'var(--text)' },
                { label:'Margen Unit.',  value: fmtClp(item.margen),                                    color:'var(--green)' },
              ].map(({ label, value, color }) => (
                <div key={label} className={styles.detailStat}>
                  <div className={styles.detailStatLabel}>{label}</div>
                  <div className={styles.detailStatValue} style={{ color }}>{value}</div>
                </div>
              ))}
            </div>
            {item.ventas_meses && (
              <div className={styles.detailSection}>
                <h4>Ventas por mes</h4>
                <div className={styles.chartWrap}>
                  {Object.entries(item.ventas_meses).map(([mes, v], i) => {
                    const vals = Object.values(item.ventas_meses).map(Number)
                    const mx = Math.max(...vals, 1)
                    return (
                      <div key={mes} className={styles.chartBar} style={{
                        background: Number(v)>0 ? (item.estado==='QUIEBRE'?'var(--red)':'var(--amber)') : 'var(--border)',
                        height: Math.round((Number(v)/mx)*60)+4
                      }}>
                        <span className={styles.chartMonth}>{MONTHS_SHORT[i]}</span>
                        <span className={styles.chartTooltip}>{mes}: {v}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── UPLOAD MODAL ────────────────────────────────────────────────────────────
function UploadModal({ onClose, onDone }) {
  const [file, setFile]       = useState(null)
  const [anio, setAnio]       = useState(new Date().getFullYear())
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult]   = useState(null)
  const [error, setError]     = useState(null)

  // ── Procesar Excel en el CLIENTE y enviar JSON a la API ──────────────────
  async function handleUpload() {
    if (!file) return
    setLoading(true); setError(null); setResult(null); setProgress('Leyendo archivo...')

    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type:'array' })

      // --- Parsear Hoja2 → productos ---
      setProgress('Procesando catálogo de productos...')
      const ws2 = wb.Sheets['Hoja2']
      if (!ws2) throw new Error('No se encontró la hoja "Hoja2" en el Excel')
      const h2rows = XLSX.utils.sheet_to_json(ws2, { defval:'' })
      const productos = h2rows
        .filter(r => r['SKU'])
        .map(r => ({
          sku:        String(r['SKU']).trim(),
          tipo:       String(r['Tipo de Producto']||'').trim(),
          producto:   String(r['Producto']||'').trim(),
          variante:   String(r['Variante']||'').trim(),
          marca:      String(r['Marca']||'').trim(),
          precio:     parseFloat(r['Precio Venta Bruto'])||0,
          costo_unit: parseFloat(r['Costo Neto Prom. Unitario'])||0,
          margen:     parseFloat(r['Margen Unitario'])||0,
        }))

      // --- Parsear BBDD → ventas y compras ---
      setProgress('Procesando historial de ventas...')
      const wsBB = wb.Sheets['BBDD']
      if (!wsBB) throw new Error('No se encontró la hoja "BBDD" en el Excel')
      const raw = XLSX.utils.sheet_to_json(wsBB, { header:1, defval:0 })
      // raw[0]=secciones raw[1]=meses raw[2+]=datos
      const ventas = []; const compras = []
      for (let i = 2; i < raw.length; i++) {
        const row = raw[i]
        const sku = String(row[0]||'').trim()
        if (!sku || sku === 'SKU') continue
        for (let m = 0; m < 12; m++) {
          const cv = parseFloat(row[1+m])||0
          const cc = parseFloat(row[13+m])||0
          if (cv) ventas.push({ sku, anio: parseInt(anio), mes: m+1, cantidad: cv, monto: 0 })
          if (cc) compras.push({ sku, anio: parseInt(anio), mes: m+1, cantidad: cc, monto: 0 })
        }
      }

      // Deduplicar productos por SKU (quedarse con el último)
      const prodMap = {}
      for (const p of productos) prodMap[p.sku] = p
      const productosFinal = Object.values(prodMap)

      // Deduplicar ventas y compras por sku+mes (quedarse con el último)
      const ventaMap = {}
      for (const v of ventas) ventaMap[`${v.sku}_${v.mes}`] = v
      const ventasFinal = Object.values(ventaMap)

      const compraMap = {}
      for (const c of compras) compraMap[`${c.sku}_${c.mes}`] = c
      const comprasFinal = Object.values(compraMap)

      setProgress(`Subiendo ${productosFinal.length} productos y ${ventasFinal.length} ventas...`)
      const res = await fetch('/api/upload-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productos: productosFinal, ventas: ventasFinal, compras: comprasFinal, anio })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
      onDone?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false); setProgress('')
    }
  }

  // ── Sync Bsale: el browser llama a Bsale directamente ───────────────────
  async function handleSyncBsale() {
    setLoading(true); setError(null); setResult(null)
    const LIMIT = 50
    try {
      // 1. Variantes
      setProgress('Cargando variantes desde Bsale...')
      const variantMap = {}
      let offset = 0
      while (true) {
        const r = await fetch(`${BSALE_BASE}/variants.json?limit=${LIMIT}&offset=${offset}&state=0`, {
          headers: { access_token: BSALE_TOKEN }
        })
        const d = await r.json()
        if (!d.items?.length) break
        for (const v of d.items) { if (v.code) variantMap[v.id] = v.code }
        if (d.items.length < LIMIT) break
        offset += LIMIT
      }

      // 2. Stocks
      setProgress(`${Object.keys(variantMap).length} variantes OK. Cargando stocks...`)
      const stockBySku = {}
      offset = 0
      while (true) {
        const r = await fetch(`${BSALE_BASE}/stocks.json?limit=${LIMIT}&offset=${offset}`, {
          headers: { access_token: BSALE_TOKEN }
        })
        const d = await r.json()
        if (!d.items?.length) break
        for (const s of d.items) {
          const vid = parseInt(s.variant?.id || s.variant?.href?.split('/').pop())
          const sku = variantMap[vid]
          if (!sku) continue
          if (!stockBySku[sku]) stockBySku[sku] = { stock:0, reservado:0, disponible:0, variantId:vid }
          stockBySku[sku].stock      += s.quantity         || 0
          stockBySku[sku].reservado  += s.quantityReserved  || 0
          stockBySku[sku].disponible += s.quantityAvailable || 0
        }
        if (d.items.length < LIMIT) break
        offset += LIMIT
      }

      // 3. Guardar en Supabase via API
      const rows = Object.entries(stockBySku).map(([sku, s]) => ({
        sku, stock: s.stock, stock_reservado: s.reservado,
        stock_disponible: s.disponible, bsale_variant_id: s.variantId,
        synced_at: new Date().toISOString()
      }))
      setProgress(`${rows.length} SKUs encontrados. Guardando en base de datos...`)
      const res = await fetch('/api/sync-bsale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult({ bsale: true, ...data })
      onDone?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false); setProgress('')
    }
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.panel} style={{ maxWidth:480 }}>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>
        <div className={styles.detailName} style={{ marginBottom:20 }}>Actualizar datos</div>

        <div className={styles.detailSection}>
          <h4>📁 Subir Excel histórico</h4>
          <p style={{ fontSize:12, color:'var(--muted)', marginBottom:12, fontFamily:"'DM Mono',monospace" }}>
            Necesita las hojas: BBDD y Hoja2
          </p>
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
            <label style={{ fontSize:12, color:'var(--muted)', fontFamily:"'DM Mono',monospace" }}>Año:</label>
            <input type="number" value={anio} min={2020} max={2030}
              onChange={e => setAnio(e.target.value)}
              style={{ width:80, background:'var(--bg)', border:'1px solid var(--border)', color:'var(--text)', padding:'6px 8px', borderRadius:6, fontFamily:"'DM Mono',monospace", fontSize:12 }}
            />
          </div>
          <input type="file" accept=".xlsx,.xls"
            onChange={e => setFile(e.target.files[0])}
            style={{ fontSize:12, color:'var(--muted)', marginBottom:12, display:'block' }}
          />
          <button onClick={handleUpload} disabled={!file||loading} className={styles.btnPrimary}>
            {loading && progress.includes('producto') ? 'Subiendo...' : 'Subir Excel'}
          </button>
        </div>

        <div className={styles.detailSection} style={{ borderTop:'1px solid var(--border)', paddingTop:20 }}>
          <h4>🔄 Sincronizar stock desde Bsale</h4>
          <p style={{ fontSize:12, color:'var(--muted)', margin:'8px 0 12px', fontFamily:"'DM Mono',monospace" }}>
            Actualiza el stock disponible en tiempo real desde Bsale.
          </p>
          <button onClick={handleSyncBsale} disabled={loading} className={styles.btnSecondary}>
            {loading && progress.includes('ariante') ? 'Sincronizando...' : 'Sync Bsale ahora'}
          </button>
        </div>

        {progress && (
          <div style={{ background:'var(--blue-dim)', border:'1px solid rgba(59,130,246,0.3)', borderRadius:8, padding:12, marginTop:16, fontFamily:"'DM Mono',monospace", fontSize:12, color:'var(--blue)' }}>
            ⟳ {progress}
          </div>
        )}
        {result && !progress && (
          <div style={{ background:'var(--green-dim)', border:'1px solid rgba(34,197,94,0.3)', borderRadius:8, padding:12, marginTop:16, fontFamily:"'DM Mono',monospace", fontSize:12, color:'var(--green)' }}>
            {result.bsale
              ? `✓ Bsale sync OK — ${result.rows_upserted} SKUs actualizados`
              : `✓ Excel OK — ${result.productos} productos, ${result.ventas} ventas`
            }
          </div>
        )}
        {error && (
          <div style={{ background:'var(--red-dim)', border:'1px solid rgba(255,77,77,0.3)', borderRadius:8, padding:12, marginTop:16, fontFamily:"'DM Mono',monospace", fontSize:12, color:'var(--red)' }}>
            ✗ {error}
          </div>
        )}
      </div>
    </div>
  )
}


// ── SIN CATALOGAR PANEL ──────────────────────────────────────────────────────
function SinCatalogarPanel({ onClose }) {
  const [items, setItems]     = useState([])
  const [count, setCount]     = useState(0)
  const [editing, setEditing] = useState(null)  // sku en edición
  const [form, setForm]       = useState({})
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState(null)

  useEffect(() => {
    fetch('/api/sin-catalogar')
      .then(r => r.json())
      .then(d => { setItems(d.data || []); setCount(d.count || 0) })
  }, [])

  function startEdit(item) {
    setEditing(item.sku)
    setForm({ ...item })
    setMsg(null)
  }

  async function saveEdit() {
    setSaving(true); setMsg(null)
    try {
      const res = await fetch('/api/sin-catalogar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setItems(prev => prev.map(i => i.sku === form.sku ? { ...form } : i))
      setEditing(null)
      setMsg({ ok: true, text: 'Guardado ✓' })
    } catch(e) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = {
    background: 'var(--bg)', border: '1px solid var(--accent)',
    color: 'var(--text)', padding: '4px 8px', borderRadius: 4,
    fontFamily: "'DM Mono', monospace", fontSize: 11, width: '100%'
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.panel} style={{ width: 700 }}>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>
        <div className={styles.detailName} style={{ marginBottom: 4 }}>Productos sin catalogar</div>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--muted)', marginBottom: 20 }}>
          {count} SKUs con ventas/compras pero sin ficha de producto. Completa sus datos para que aparezcan correctamente en el dashboard.
        </div>

        {msg && (
          <div style={{ background: msg.ok ? 'var(--green-dim)' : 'var(--red-dim)', border: `1px solid ${msg.ok ? 'rgba(34,197,94,0.3)' : 'rgba(255,77,77,0.3)'}`, borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontFamily: "'DM Mono', monospace", fontSize: 11, color: msg.ok ? 'var(--green)' : 'var(--red)' }}>
            {msg.text}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map(item => (
            <div key={item.sku} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
              {editing === item.sku ? (
                <div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--accent)', marginBottom: 8 }}>{item.sku}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    {[
                      { key: 'tipo',     label: 'Tipo' },
                      { key: 'marca',    label: 'Marca' },
                      { key: 'producto', label: 'Producto' },
                      { key: 'variante', label: 'Variante' },
                    ].map(({ key, label }) => (
                      <div key={key}>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: 'var(--muted)', marginBottom: 2 }}>{label}</div>
                        <input style={inputStyle} value={form[key] || ''} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                    {[
                      { key: 'precio',    label: 'Precio' },
                      { key: 'costo_unit',label: 'Costo Unit.' },
                      { key: 'margen',    label: 'Margen' },
                    ].map(({ key, label }) => (
                      <div key={key}>
                        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: 'var(--muted)', marginBottom: 2 }}>{label}</div>
                        <input type="number" style={inputStyle} value={form[key] || 0} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={saveEdit} disabled={saving} className={styles.btnPrimary} style={{ fontSize: 11, padding: '6px 14px' }}>
                      {saving ? 'Guardando...' : 'Guardar'}
                    </button>
                    <button onClick={() => setEditing(null)} className={styles.btnSecondary} style={{ fontSize: 11, padding: '6px 14px' }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--accent)' }}>{item.sku}</div>
                    <div style={{ fontSize: 12, color: item.producto === 'Sin nombre — pendiente de completar' ? 'var(--muted)' : 'var(--text)', marginTop: 2 }}>
                      {item.producto}
                    </div>
                    {item.marca && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{item.tipo} · {item.marca}</div>}
                  </div>
                  <button onClick={() => startEdit(item)} className={styles.btnSecondary} style={{ fontSize: 11, padding: '5px 12px', whiteSpace: 'nowrap' }}>
                    ✏ Editar
                  </button>
                </div>
              )}
            </div>
          ))}
          {items.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
              ✓ No hay productos sin catalogar
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── DASHBOARD ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [kpis, setKpis]       = useState(null)
  const [items, setItems]     = useState([])
  const [count, setCount]     = useState(0)
  const [page, setPage]       = useState(1)
  const [tab, setTab]         = useState('quiebre')
  const [q, setQ]             = useState('')
  const [tipo, setTipo]       = useState('')
  const [marca, setMarca]     = useState('')
  const [tipos, setTipos]     = useState([])
  const [marcas, setMarcas]   = useState([])
  const [loading, setLoading] = useState(false)
  const [detailSku, setDetailSku]   = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  const [showSinCat, setShowSinCat] = useState(false)
  const searchTimer = useRef(null)
  const LIMIT = 50

  useEffect(() => {
    fetch('/api/kpis').then(r => r.json()).then(setKpis)
    fetch('/api/filters').then(r => r.json()).then(d => {
      setTipos(d.tipos || [])
      setMarcas(d.marcas || [])
    })
  }, [])

  const fetchData = useCallback(async (overrides = {}) => {
    setLoading(true)
    const params = new URLSearchParams({
      tab:   overrides.tab   ?? tab,
      q:     overrides.q     ?? q,
      tipo:  overrides.tipo  ?? tipo,
      marca: overrides.marca ?? marca,
      page:  overrides.page  ?? page,
    })
    const res  = await fetch(`/api/dashboard?${params}`)
    const data = await res.json()
    setItems(data.data || [])
    setCount(data.count || 0)
    setLoading(false)
  }, [tab, q, tipo, marca, page])

  useEffect(() => { fetchData() }, [tab, tipo, marca, page])

  function handleSearch(val) {
    setQ(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setPage(1); fetchData({ q:val, page:1 }) }, 350)
  }

  function refreshAll() {
    fetchData()
    fetch('/api/kpis').then(r => r.json()).then(setKpis)
    fetch('/api/filters').then(r => r.json()).then(d => { setTipos(d.tipos||[]); setMarcas(d.marcas||[]) })
  }

  const totalPages = Math.ceil(count / LIMIT)

  const TABS = [
    { id:'quiebre', label:'Comprar Urgente',    cls:styles.tabRed,   count: kpis?.quiebres },
    { id:'sinmov',  label:'Sobrestock/Rematar',  cls:styles.tabAmber, count: kpis?.sin_movimiento },
    { id:'todos',   label:'Todos',               cls:styles.tabBlue,  count: null },
  ]

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div>
          <div className={styles.logo}>grey<span>.</span>stock</div>
          <div className={styles.headerSub}>Sistema de gestión de inventario</div>
        </div>
        <div className={styles.headerRight}>
          {kpis?.last_sync && (
            <div className={styles.syncBadge}>
              ↻ {new Date(kpis.last_sync).toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'})}
            </div>
          )}
          <div className={styles.liveBadge}>EN VIVO</div>
          <button className={styles.btnUpdate} onClick={() => setShowSinCat(true)} style={{ background:'var(--amber-dim)', borderColor:'rgba(245,158,11,0.3)', color:'var(--amber)' }}>
            ✏ Sin catalogar
          </button>
          <button className={styles.btnUpdate} onClick={() => setShowUpload(true)}>↑ Actualizar datos</button>
        </div>
      </header>

      {kpis && (
        <div className={styles.kpiStrip}>
          {[
            { label:'Quiebres de Stock',   value: kpis.quiebres?.toLocaleString(),       sub:'productos sin stock',    cls:styles.kpiRed   },
            { label:'Sin Movimiento',      value: kpis.sin_movimiento?.toLocaleString(),  sub:'candidatos a rematar',   cls:styles.kpiAmber },
            { label:'Ventas 12m',          value: fmtClp(kpis.ventas_12m),               sub:'monto total',            cls:styles.kpiGreen },
            { label:'Inversión Paralizada',value: fmtClp(kpis.inv_paralizada),           sub:'costo stock sin mov.',   cls:styles.kpiBlue  },
          ].map(k => (
            <div key={k.label} className={`${styles.kpi} ${k.cls}`}>
              <div className={styles.kpiLabel}>{k.label}</div>
              <div className={styles.kpiValue}>{k.value}</div>
              <div className={styles.kpiSub}>{k.sub}</div>
            </div>
          ))}
        </div>
      )}

      <div className={styles.tabsBar}>
        {TABS.map(t => (
          <button key={t.id}
            className={`${styles.tab} ${t.cls} ${tab===t.id?styles.tabActive:''}`}
            onClick={() => { setTab(t.id); setPage(1) }}
          >
            {t.label}
            {t.count != null && <span className={styles.tabCount}>{t.count?.toLocaleString()}</span>}
          </button>
        ))}
      </div>

      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}>⌕</span>
          <input value={q} onChange={e => handleSearch(e.target.value)}
            placeholder="Buscar producto, SKU, marca..."
            className={styles.searchInput} />
        </div>
        <select value={tipo} onChange={e => { setTipo(e.target.value); setPage(1) }} className={styles.select}>
          <option value="">Todos los tipos</option>
          {tipos.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={marca} onChange={e => { setMarca(e.target.value); setPage(1) }} className={styles.select}>
          <option value="">Todas las marcas</option>
          {marcas.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className={styles.resultsCount}>
          {loading ? 'Cargando...' : `${count.toLocaleString()} productos`}
        </span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {['Tipo','Producto','SKU','Stock','Rotación','Ventas 12m','Tendencia','Precio','Margen','Estado'].map(col => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(d => (
              <tr key={d.sku} onClick={() => setDetailSku(d.sku)} className={styles.tableRow}>
                <td><span className={styles.tipoBadge}>{d.tipo||'—'}</span></td>
                <td className={styles.tdProducto}>
                  <div style={{ fontWeight:600, fontSize:13 }}>{d.producto||'—'}</div>
                  <div style={{ fontSize:11, color:'var(--muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:200 }}>{d.variante}</div>
                  <div style={{ fontSize:11, color:'var(--muted)' }}>{d.marca}</div>
                </td>
                <td style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:'var(--muted)' }}>{d.sku}</td>
                <td style={{ fontFamily:"'DM Mono',monospace", textAlign:'right', fontWeight:700, color: d.stock===0?'var(--red)':'var(--text)' }}>{d.stock}</td>
                <td style={{ fontFamily:"'DM Mono',monospace", textAlign:'right', color: d.rotacion>10?'var(--green)':d.rotacion>2?'var(--amber)':'var(--muted)' }}>
                  {Number(d.rotacion||0).toFixed(1)}
                </td>
                <td style={{ fontFamily:"'DM Mono',monospace", textAlign:'right' }}>{Number(d.ventas_12m||0).toLocaleString('es-CL')}</td>
                <td><SparkBars ventas={d.ventas_meses} /></td>
                <td style={{ fontFamily:"'DM Mono',monospace", textAlign:'right' }}>{fmtClp(d.precio)}</td>
                <td style={{ fontFamily:"'DM Mono',monospace", textAlign:'right', color:'var(--green)' }}>{fmtClp(d.margen)}</td>
                <td>
                  {d.estado==='QUIEBRE'
                    ? <span className={`${styles.pill} ${styles.pillRed}`}>⚠ QUIEBRE</span>
                    : <span className={`${styles.pill} ${styles.pillAmber}`}>○ SIN MOV.</span>
                  }
                </td>
              </tr>
            ))}
            {!loading && items.length===0 && (
              <tr><td colSpan={10} style={{ textAlign:'center', padding:40, color:'var(--muted)', fontFamily:"'DM Mono',monospace", fontSize:12 }}>
                Sin resultados
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.pager}>
        <button className={styles.pagerBtn} disabled={page<=1} onClick={() => setPage(p=>p-1)}>← Anterior</button>
        <span className={styles.pagerInfo}>Página {page} de {totalPages||1}</span>
        <button className={styles.pagerBtn} disabled={page>=totalPages} onClick={() => setPage(p=>p+1)}>Siguiente →</button>
        <span style={{ marginLeft:'auto', fontFamily:"'DM Mono',monospace", fontSize:11, color:'var(--muted)' }}>
          {Math.min((page-1)*LIMIT+1,count)}–{Math.min(page*LIMIT,count)} de {count.toLocaleString()}
        </span>
      </div>

      {detailSku && <DetailPanel sku={detailSku} onClose={() => setDetailSku(null)} />}
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onDone={refreshAll} />}
      {showSinCat && <SinCatalogarPanel onClose={() => setShowSinCat(false)} />}
    </div>
  )
}
