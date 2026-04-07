# grey.stock — Sistema de Gestión de Inventario

Dashboard de rotación, quiebres y sobrestock conectado a Supabase + Bsale.

---

## Stack

- **Frontend + API**: Next.js 14 (App Router) → Vercel
- **Base de datos**: Supabase (Postgres)
- **Stock en tiempo real**: Bsale API
- **Datos históricos**: Excel (BBDD + Hoja2)

---

## Setup paso a paso

### 1. Supabase — Crear tablas

1. Ir a [supabase.com](https://supabase.com) → tu proyecto
2. Menú lateral → **SQL Editor**
3. Pegar y ejecutar el contenido de `scripts/schema.sql`
4. Verificar que se crearon las tablas: `productos`, `ventas_mensuales`, `compras_mensuales`, `stock_actual`

### 2. Variables de entorno

Copiar `.env.example` a `.env.local` y completar:

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://kcldvcubkwsihckdvdgz.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # Supabase > Settings > API > service_role
BSALE_ACCESS_TOKEN=150efac9...
CRON_SECRET=una_clave_random_segura  # para proteger el endpoint de sync
```

### 3. Instalar y correr local

```bash
npm install
npm run dev
# → http://localhost:3000
```

### 4. Subir a Vercel

```bash
# Opción A: desde GitHub (recomendado)
# 1. Crear repo en GitHub
# 2. git init && git add . && git commit -m "init" && git push
# 3. Ir a vercel.com → Import Project → seleccionar repo
# 4. Agregar las variables de entorno en Vercel Dashboard

# Opción B: Vercel CLI
npm i -g vercel
vercel --prod
```

### 5. Cargar datos iniciales

Una vez desplegado:

1. Ir al dashboard → botón **↑ Actualizar datos**
2. Subir el Excel (necesita hojas: `BBDD` y `Hoja2`)
3. Seleccionar el año del historial (2024)
4. Click **Subir Excel**
5. Luego click **Sync Bsale ahora** para cargar el stock actual

El sync de Bsale también corre automáticamente **todos los días a las 6am** (via Vercel Cron).

---

## Agregar datos de nuevos meses

Cada vez que tengas un nuevo mes de datos:

1. Actualizar tu Excel con la nueva columna del mes en la hoja `BBDD`
2. Ir al dashboard → **↑ Actualizar datos**
3. Cambiar el **año** si corresponde
4. Subir el Excel actualizado

Los datos se hacen upsert (no se duplican), así que puedes subir el mismo Excel varias veces sin problema.

---

## Estructura del proyecto

```
greystock/
├── app/
│   ├── api/
│   │   ├── dashboard/route.js     # Datos paginados del dashboard
│   │   ├── kpis/route.js          # KPIs del header
│   │   ├── filters/route.js       # Tipos y marcas para filtros
│   │   ├── upload-excel/route.js  # Procesa y carga Excel a Supabase
│   │   └── sync-bsale/route.js    # Sincroniza stock desde Bsale
│   ├── page.js                    # Dashboard principal
│   ├── page.module.css
│   ├── layout.js
│   └── globals.css
├── lib/
│   └── supabase.js                # Cliente Supabase (público + admin)
├── scripts/
│   └── schema.sql                 # SQL para crear tablas en Supabase
├── .env.example
├── .env.local                     # ⚠️ NO subir a Git
├── .gitignore
├── next.config.js
├── vercel.json                    # Cron job: sync Bsale 6am diario
└── package.json
```

---

## API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/dashboard` | Productos paginados con filtros |
| GET | `/api/kpis` | KPIs globales |
| GET | `/api/filters` | Listas de tipos y marcas |
| POST | `/api/upload-excel` | Carga Excel a Supabase |
| POST | `/api/sync-bsale` | Sincroniza stock desde Bsale |

---

## Seguridad

- Las API routes de escritura (`upload-excel`, `sync-bsale`) requieren la `SUPABASE_SERVICE_ROLE_KEY` que **nunca** se expone al frontend
- El endpoint de sync puede protegerse con `CRON_SECRET` en los headers
- RLS de Supabase: lectura pública, escritura solo para `service_role`
- **Nunca subir `.env.local` a Git** (ya está en `.gitignore`)
