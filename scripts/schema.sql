-- ============================================================
-- grey.stock — Supabase Schema
-- Ejecutar en Supabase > SQL Editor
-- ============================================================

-- 1. Productos (catálogo base)
create table if not exists productos (
  sku           text primary key,
  tipo          text,
  producto      text,
  variante      text,
  marca         text,
  categoria     text,
  subcategoria  text,
  precio        numeric default 0,
  costo_unit    numeric default 0,
  margen        numeric default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- 2. Ventas mensuales (historial desde Excel)
create table if not exists ventas_mensuales (
  id         bigserial primary key,
  sku        text references productos(sku) on delete cascade,
  anio       int  not null,
  mes        int  not null check (mes between 1 and 12),
  cantidad   int  default 0,
  monto      numeric default 0,
  unique (sku, anio, mes)
);

-- 3. Compras mensuales (historial desde Excel)
create table if not exists compras_mensuales (
  id         bigserial primary key,
  sku        text references productos(sku) on delete cascade,
  anio       int  not null,
  mes        int  not null check (mes between 1 and 12),
  cantidad   int  default 0,
  monto      numeric default 0,
  unique (sku, anio, mes)
);

-- 4. Stock snapshots (desde Bsale API, se actualiza periódicamente)
create table if not exists stock_actual (
  sku              text primary key references productos(sku) on delete cascade,
  stock            numeric default 0,
  stock_reservado  numeric default 0,
  stock_disponible numeric default 0,
  bsale_variant_id int,
  synced_at        timestamptz default now()
);

-- 5. Vista consolidada (usada por el dashboard)
create or replace view dashboard_view as
with rotacion as (
  select
    sku,
    round(sum(cantidad)::numeric / nullif(count(distinct (anio * 100 + mes)), 0), 4) as rotacion_mensual,
    sum(cantidad) as ventas_12m,
    sum(monto)    as monto_12m
  from ventas_mensuales
  where (anio * 100 + mes) >= (
    extract(year from now() - interval '12 months')::int * 100 +
    extract(month from now() - interval '12 months')::int
  )
  group by sku
),
compras as (
  select
    sku,
    round(sum(cantidad)::numeric / nullif(count(distinct (anio * 100 + mes)), 0), 4) as compras_mensual
  from compras_mensuales
  where (anio * 100 + mes) >= (
    extract(year from now() - interval '12 months')::int * 100 +
    extract(month from now() - interval '12 months')::int
  )
  group by sku
),
ventas_por_mes as (
  select
    sku,
    json_object_agg(lpad(mes::text, 2, '0'), cantidad order by mes) as ventas_meses
  from ventas_mensuales
  where anio = extract(year from now())::int
     or (anio = extract(year from now())::int - 1 and mes >= extract(month from now())::int)
  group by sku
)
select
  p.sku,
  p.tipo,
  p.producto,
  p.variante,
  p.marca,
  p.precio,
  p.costo_unit,
  p.margen,
  coalesce(s.stock_disponible, 0)          as stock,
  coalesce(r.rotacion_mensual, 0)          as rotacion,
  coalesce(r.ventas_12m, 0)               as ventas_12m,
  coalesce(r.monto_12m, 0)               as monto_12m,
  s.synced_at,
  case
    when coalesce(s.stock_disponible, 0) = 0 and coalesce(r.rotacion_mensual, 0) > 0
      then 'QUIEBRE'
    when coalesce(r.rotacion_mensual, 0) = 0 and coalesce(s.stock_disponible, 0) = 0
      then 'NUEVO'
    when coalesce(r.rotacion_mensual, 0) = 0
      then 'SIN MOVIMIENTO'
    else 'OK'
  end as estado,
  -- Sugerencia: cubrir 7 días (1 semana). Nuevos sin rotación → compras históricas o mínimo 3
  greatest(0, ceil(
    case
      when coalesce(r.rotacion_mensual, 0) > 0
        then r.rotacion_mensual / 30.0 * 7 - coalesce(s.stock_disponible, 0)
      when coalesce(c.compras_mensual, 0) > 0
        then c.compras_mensual / 30.0 * 7 - coalesce(s.stock_disponible, 0)
      else 3
    end
  ))::int as sugerencia_compra,
  vm.ventas_meses
from productos p
left join stock_actual    s  on s.sku = p.sku
left join rotacion        r  on r.sku = p.sku
left join compras         c  on c.sku = p.sku
left join ventas_por_mes  vm on vm.sku = p.sku;

-- 6. Índices
create index if not exists idx_ventas_sku  on ventas_mensuales(sku);
create index if not exists idx_ventas_mes  on ventas_mensuales(anio, mes);
create index if not exists idx_compras_sku on compras_mensuales(sku);
create index if not exists idx_stock_sku   on stock_actual(sku);

-- 7. RLS — habilitar pero permitir lectura pública (ajustar según necesidad)
alter table productos       enable row level security;
alter table ventas_mensuales  enable row level security;
alter table compras_mensuales enable row level security;
alter table stock_actual      enable row level security;

-- Políticas de lectura para el frontend (anon key)
create policy "read_productos"        on productos        for select using (true);
create policy "read_ventas"           on ventas_mensuales   for select using (true);
create policy "read_compras"          on compras_mensuales  for select using (true);
create policy "read_stock"            on stock_actual       for select using (true);

-- Políticas de escritura SOLO para service_role (backend)
create policy "write_productos"       on productos        for all using (auth.role() = 'service_role');
create policy "write_ventas"          on ventas_mensuales   for all using (auth.role() = 'service_role');
create policy "write_compras"         on compras_mensuales  for all using (auth.role() = 'service_role');
create policy "write_stock"           on stock_actual       for all using (auth.role() = 'service_role');
