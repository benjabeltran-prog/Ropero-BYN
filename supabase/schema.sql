-- ============================================================
-- Ropero — esquema de base de datos (Supabase / Postgres)
-- Este proyecto es compartido con Launch Control, así que todo
-- vive en su propio schema "ropero" para no mezclarse con nada.
-- El acceso de administración está acotado a UN usuario específico
-- (tu cuenta admin), no a "cualquier usuario autenticado", porque
-- el proyecto podría sumar otros usuarios en el futuro (Launch Control).
-- ============================================================

-- 0) Reemplaza este UUID por el id de tu usuario admin
--    (Authentication → Users → copiar "User UID")
-- Admin actual: benjabeltran@gmail.com
--   4f481729-bef5-4316-9e9f-5685fa718428

create schema if not exists ropero;
grant usage on schema ropero to anon, authenticated;

-- 1) Tabla principal de prendas -------------------------------------------
create table if not exists ropero.items (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Prenda de segunda mano',
  description text,
  price numeric(12, 0) not null check (price >= 0),
  category text,          -- ej: Mujer, Hombre, Niños, Accesorios
  size text,               -- talla
  condition text,          -- estado: Nuevo con etiqueta, Como nuevo, Buen estado, Con detalles
  status text not null default 'borrador'
    check (status in ('borrador', 'disponible', 'reservada', 'vendida')),
  photo_original text,
  photo_enhanced text,
  photo_variant_1 text, -- sin uso por ahora (la función solo genera la foto mejorada)
  photo_variant_2 text, -- sin uso por ahora (la función solo genera la foto mejorada)
  created_at timestamptz not null default now(),
  reserved_at timestamptz
);

comment on table ropero.items is 'Prendas del catálogo de Ropero';
comment on column ropero.items.status is
  'borrador = generada por IA, aún no publicada. disponible = visible y reservable. reservada = alguien la apartó. vendida = ya se entregó/cobró.';

grant select on ropero.items to anon;
grant select, insert, update, delete on ropero.items to authenticated;

-- 2) Row Level Security -----------------------------------------------------
alter table ropero.items enable row level security;

-- Cualquier visitante (anon) solo ve prendas publicadas (no borradores)
drop policy if exists "public_read_published" on ropero.items;
create policy "public_read_published"
  on ropero.items for select
  to anon
  using (status <> 'borrador');

-- Solo tu cuenta admin puede leer/gestionar todo (no "cualquier autenticado",
-- porque este proyecto es compartido con Launch Control)
drop policy if exists "admin_read_all" on ropero.items;
create policy "admin_read_all"
  on ropero.items for select
  to authenticated
  using (auth.uid() = '4f481729-bef5-4316-9e9f-5685fa718428');

drop policy if exists "admin_insert" on ropero.items;
create policy "admin_insert"
  on ropero.items for insert
  to authenticated
  with check (auth.uid() = '4f481729-bef5-4316-9e9f-5685fa718428');

drop policy if exists "admin_update" on ropero.items;
create policy "admin_update"
  on ropero.items for update
  to authenticated
  using (auth.uid() = '4f481729-bef5-4316-9e9f-5685fa718428');

drop policy if exists "admin_delete" on ropero.items;
create policy "admin_delete"
  on ropero.items for delete
  to authenticated
  using (auth.uid() = '4f481729-bef5-4316-9e9f-5685fa718428');

-- 3) Función para reservar una prenda desde el catálogo público -------------
-- Corre con privilegios elevados (security definer) para poder cambiar el
-- estado aunque quien la llama sea un visitante anónimo. Solo permite pasar
-- de 'disponible' a 'reservada', y solo una vez (evita choques si dos
-- personas aprietan el botón casi al mismo tiempo).
create or replace function ropero.reserve_item(item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ropero
as $$
declare
  updated_count int;
begin
  update ropero.items
    set status = 'reservada', reserved_at = now()
    where id = item_id and status = 'disponible';
  get diagnostics updated_count = row_count;
  return updated_count > 0;
end;
$$;

grant execute on function ropero.reserve_item(uuid) to anon, authenticated;

-- 4) Storage: bucket público para las fotos ----------------------------------
insert into storage.buckets (id, name, public)
values ('ropero-photos', 'ropero-photos', true)
on conflict (id) do nothing;

drop policy if exists "ropero_public_read_photos" on storage.objects;
create policy "ropero_public_read_photos"
  on storage.objects for select
  using (bucket_id = 'ropero-photos');

drop policy if exists "ropero_admin_upload_photos" on storage.objects;
create policy "ropero_admin_upload_photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'ropero-photos' and auth.uid() = '4f481729-bef5-4316-9e9f-5685fa718428');

drop policy if exists "ropero_admin_update_photos" on storage.objects;
create policy "ropero_admin_update_photos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'ropero-photos' and auth.uid() = '4f481729-bef5-4316-9e9f-5685fa718428');

drop policy if exists "ropero_admin_delete_photos" on storage.objects;
create policy "ropero_admin_delete_photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'ropero-photos' and auth.uid() = '4f481729-bef5-4316-9e9f-5685fa718428');

-- Nota: la Edge Function "ropero-enhance-product" usa la service_role key,
-- que salta el RLS y las políticas de Storage automáticamente — no necesita
-- estar autenticada como usuario para subir fotos ni insertar filas.
