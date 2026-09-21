# Ropero — estado del despliegue

Ya dejé todo funcionando de punta a punta y probado en vivo. Este
documento es un resumen de lo que hay y lo poco que falta de tu lado.

## Lo que ya está hecho

- **Backend**: proyecto Supabase de **Launch Control**, en un schema
  separado `ropero` (no toca ni comparte tablas con Launch Control).
  Tabla `items`, permisos (RLS) y la función `reserve_item` ya corridos
  ([`supabase/schema.sql`](supabase/schema.sql) es el registro de lo que
  se ejecutó).
- **Storage**: bucket público `ropero-photos` creado.
- **Tu usuario admin**: `benjabeltran@gmail.com`, ya creado y probado —
  es el único que puede administrar Ropero en ese proyecto compartido.
- **Función de IA**: `ropero-enhance-product` desplegada y probada
  end-to-end (generar → publicar → reservar). Mejora la foto con
  auto-corrección de niveles/contraste (gratis, sin costo por imagen —
  no usa el modelo de imágenes de Gemini, que requiere facturación) y
  escribe la descripción con Gemini en texto (también gratis).
- **Frontend**: `js/config.js` ya tiene la URL y la key de Supabase, y tu
  número de WhatsApp (`56966574792`) cableado en el botón de Reservar.
- **GitHub Pages**: ya está online en
  `https://benjabeltran-prog.github.io/Ropero-BYN/`.

## Lo único que falta

1. **Dominio propio** (`app.ventaropa.site.je`): agrega el CNAME en tu
   proveedor DNS (`app` → `benjabeltran-prog.github.io`) y el dominio en
   **Settings → Pages → Custom domain** del repo, si no lo hiciste ya.

## Probar el flujo completo

1. Entra a `/admin.html`, inicia sesión con tu cuenta admin.
2. Sube una foto real, pon precio/categoría/talla/estado, toca
   **Generar con IA**.
3. Revisa la foto mejorada y la descripción — edítalas si hace falta —
   y toca **Publicar**.
4. Abre `/index.html`, toca la prenda, toca **Reservar por WhatsApp** —
   la marca como "Reservada" y te abre WhatsApp con el mensaje
   prellenado.
5. En el admin, pestaña **Prendas**, marca **Vendida** o **Liberar**
   según corresponda.

## Nota sobre la foto mejorada

La mejora de foto es un "auto niveles" clásico (como en Photoshop/GIMP):
estira el rango de luz y color de tu foto real para que se vea más
nítida y con mejor contraste. No es IA generativa — no inventa fondos
ni ángulos nuevos, no cambia la prenda. Si quisieras en el futuro una
mejora más "creativa" (fondo limpio, estilo estudio), eso requiere
Gemini con facturación habilitada (~US$0.05-0.07 por prenda) — avísame
si en algún momento quieres ese salto de calidad.

## Costos

- Supabase: dentro del free tier ya usado por Launch Control, sin costo
  adicional por Ropero a este volumen.
- Gemini: solo texto (la descripción), gratis.
- Mejora de foto: procesamiento propio, sin costo.
- GitHub Pages + dominio InfinityFree: gratis, igual que tus otras apps.
