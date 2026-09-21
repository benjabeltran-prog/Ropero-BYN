# Ropero — estado del despliegue

Ya dejé casi todo funcionando de punta a punta. Este documento es un
resumen de lo que hay y lo poco que falta de tu lado.

## Lo que ya está hecho

- **Backend**: proyecto Supabase de **Launch Control**, en un schema
  separado `ropero` (no toca ni comparte tablas con Launch Control).
  Tabla `items`, permisos (RLS) y la función `reserve_item` ya corridos
  ([`supabase/schema.sql`](supabase/schema.sql) es el registro de lo que
  se ejecutó).
- **Storage**: bucket público `ropero-photos` creado.
- **Tu usuario admin**: `benjabeltran@gmail.com`, ya creado y probado —
  es el único que puede administrar Ropero en ese proyecto compartido.
- **Función de IA**: `ropero-enhance-product` desplegada, llama a Gemini
  para mejorar la foto, generar 2 variantes y escribir la descripción.
- **Frontend**: `js/config.js` ya tiene la URL y la key de Supabase, y tu
  número de WhatsApp (`56966574792`) cableado en el botón de Reservar.

## Lo único que falta

1. **Facturación de Gemini para imágenes.** El modelo de imágenes de
   Gemini ("Nano Banana") no tiene tier gratis — necesita facturación
   habilitada en el proyecto de Google Cloud de tu API key. La
   generación de **texto** (la descripción) sí es gratis y ya la probé
   funcionando. Actívala en [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   (o vinculando una cuenta de facturación en
   [console.cloud.google.com/billing](https://console.cloud.google.com/billing)
   al proyecto de esa key). Costo real: ~US$0.05-0.07 por imagen
   generada, ~US$0.15-0.20 por prenda publicada (genera 3 imágenes).
2. **Publicar con GitHub Pages**: en este repo, ve a **Settings → Pages
   → Source: Deploy from a branch → Branch: main / (root)**. En un par
   de minutos queda online en
   `https://benjabeltran-prog.github.io/Ropero-BYN/`.
3. **Opcional — dominio propio**: igual que con Fambase
   (`app.fambase.site.je`), puedes apuntar un subdominio gratis de
   InfinityFree por CNAME a GitHub Pages y agregarlo en
   **Settings → Pages → Custom domain**.

## Probar el flujo completo

1. Entra a `/admin.html`, inicia sesión con tu cuenta admin.
2. Sube una foto real, pon precio/categoría/talla/estado, toca
   **Generar con IA** (esto es lo que queda bloqueado hasta el punto 1).
3. Revisa la foto mejorada, las 2 variantes y la descripción — edítalas
   si hace falta — y toca **Publicar**.
4. Abre `/index.html`, toca la prenda, toca **Reservar por WhatsApp** —
   la marca como "Reservada" y te abre WhatsApp con el mensaje
   prellenado.
5. En el admin, pestaña **Prendas**, marca **Vendida** o **Liberar**
   según corresponda.

## Nota sobre las "2 imágenes adicionales"

La IA no tiene otra foto real de la prenda, así que genera una
*recreación* razonable (estilo flat lay y estilo maniquí/perchero) a
partir de la foto original — no son ángulos reales adicionales. Para
prendas donde el detalle importa mucho (una mancha, una costura), sigue
siendo buena idea sacar tú una segunda foto real.

## Costos

- Supabase: dentro del free tier ya usado por Launch Control, sin costo
  adicional por Ropero a este volumen.
- Gemini: texto gratis; imágenes ~US$0.15-0.20 por prenda publicada
  (ver punto 1 arriba).
- GitHub Pages + dominio InfinityFree: gratis, igual que tus otras apps.
