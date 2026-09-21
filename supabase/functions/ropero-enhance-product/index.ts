// ============================================================
// Edge Function: ropero-enhance-product
// ------------------------------------------------------------
// Recibe la foto de una prenda + datos básicos (precio, categoría,
// talla, estado) y:
//   1) sube la foto TAL CUAL la subió el admin a Storage (una sola
//      imagen — antes se generaba además una versión "mejorada" con
//      auto-corrección de nivel/contraste, pero se sacó por completo:
//      terminaba desviando el color real de la prenda. Ver detalle
//      más abajo)
//   2) escribe una descripción factual con Gemini, mirando la foto
//      (texto, gratis)
// Crea la fila en "items" con estado "borrador" para que la revises
// antes de publicar.
//
// NOTA sobre la foto única: se probaron dos versiones de auto-niveles
// (por canal, y después una basada en luminancia global) y con fotos
// reales las dos terminaban aplastando el color de la prenda cuando
// era de un tono bien distinto al fondo — que es prácticamente
// siempre el caso acá, porque el algoritmo no distingue "la prenda"
// de "el fondo", solo ve un histograma de toda la foto. La foto
// original no tiene ese riesgo (no se toca un solo pixel), así que
// ahora es la única que se genera y se usa en todo el catálogo/admin.
// Tampoco hace falta corregir la rotación EXIF a mano: al subir la
// foto tal cual, el navegador la rota solo usando ese mismo tag.
//
// Variables de entorno necesarias (se configuran al desplegar,
// ver SETUP.md):
//   GEMINI_API_KEY
// (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen inyectadas
// automáticamente por Supabase en toda Edge Function)
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildDescription, callGeminiVisualFields } from "../_shared/gemini-description.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "ropero-photos";

// Ropero comparte este proyecto Supabase con Launch Control: todo lo de
// Ropero vive en el schema "ropero" para no mezclarse con sus tablas.
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  db: { schema: "ropero" },
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// callGeminiVisualFields, extractField y buildDescription viven en
// ../_shared/gemini-description.ts (compartidas con
// ropero-regenerate-description, para que ambas funciones generen la
// descripción exactamente de la misma forma).

async function uploadImage(path: string, bytes: Uint8Array, mimeType: string) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: mimeType,
    upsert: true,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const body = await req.json();
    const { imageBase64, mimeType, price, category, size, condition } = body ?? {};

    if (!imageBase64 || !mimeType || price === undefined || price === null) {
      return json(
        { error: "Faltan datos obligatorios: imageBase64, mimeType y price" },
        400
      );
    }

    const itemId = crypto.randomUUID();
    const ext = (mimeType.split("/")[1] || "jpg").replace("jpeg", "jpg");
    const originalBytes = base64ToBytes(imageBase64);

    // 1) Foto tal cual la subió el admin — la única que se genera y usa.
    const originalUrl = await uploadImage(`${itemId}/original.${ext}`, originalBytes, mimeType);

    // 2) Descripción: marca/material/color los identifica Gemini mirando la
    // foto (gratis, solo texto); talla y estado son los que ya escribió el
    // admin. El resultado es una descripción factual, no un texto de venta.
    const aiFieldsRaw = await callGeminiVisualFields(imageBase64, mimeType);
    const description = buildDescription(aiFieldsRaw, { size, condition });

    // 3) Guardar como borrador para que lo revises antes de publicar
    const { data: item, error: insertError } = await supabase
      .from("items")
      .insert({
        id: itemId,
        title: category ? `${category}${size ? " · talla " + size : ""}` : "Prenda de segunda mano",
        description,
        price,
        category,
        size,
        condition,
        status: "borrador",
        photo_original: originalUrl,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return json({ item });
  } catch (err) {
    console.error(err);
    // Los errores de supabase-js (Postgrest/Storage) no siempre son
    // instancias de Error, así que probamos varias formas de sacarles
    // un mensaje legible antes de rendirnos.
    // deno-lint-ignore no-explicit-any
    const anyErr = err as any;
    const message =
      (typeof anyErr?.message === "string" && anyErr.message) ||
      (typeof anyErr === "string" && anyErr) ||
      (() => {
        try {
          return JSON.stringify(anyErr);
        } catch {
          return String(anyErr);
        }
      })();
    return json({ error: message }, 500);
  }
});
