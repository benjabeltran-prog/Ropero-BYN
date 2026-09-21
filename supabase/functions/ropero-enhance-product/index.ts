// ============================================================
// Edge Function: enhance-product
// ------------------------------------------------------------
// Recibe la foto de una prenda + datos básicos (precio, categoría,
// talla, estado) y usa Gemini para:
//   1) generar una versión "mejorada" de la foto
//   2) generar 2 variantes de presentación (flat lay y en maniquí)
//   3) escribir una descripción breve de venta
// Sube las 4 imágenes a Storage y crea la fila en "items"
// con estado "borrador" para que la revises antes de publicar.
//
// Variables de entorno necesarias (se configuran al desplegar,
// ver SETUP.md):
//   GEMINI_API_KEY
// (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen inyectadas
// automáticamente por Supabase en toda Edge Function)
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const BUCKET = "ropero-photos";

const IMAGE_MODEL = "gemini-3.1-flash-image"; // "Nano Banana 2"
const TEXT_MODEL = "gemini-flash-latest"; // alias siempre apuntando al Flash vigente

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

async function callGeminiImage(promptText: string, imageBase64: string, mimeType: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: mimeType, data: imageBase64 } },
              { text: promptText },
            ],
          },
        ],
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Gemini (imagen) devolvió ${res.status}: ${await res.text()}`);
  }
  const responseJson = await res.json();
  const parts = responseJson?.candidates?.[0]?.content?.parts ?? [];
  // deno-lint-ignore no-explicit-any
  const imagePart = parts.find((p: any) => p.inlineData || p.inline_data);
  const data = imagePart?.inlineData?.data ?? imagePart?.inline_data?.data;
  const outMimeType =
    imagePart?.inlineData?.mimeType ?? imagePart?.inline_data?.mime_type ?? "image/png";
  if (!data) {
    throw new Error("Gemini no devolvió una imagen para este paso");
  }
  return { data, mimeType: outMimeType };
}

async function callGeminiDescription(
  imageBase64: string,
  mimeType: string,
  meta: { price: string; category?: string; size?: string; condition?: string }
) {
  const prompt = `Escribe una descripción breve (2 a 3 frases, español de Chile, tono cercano y honesto) para vender esta prenda de segunda mano en un catálogo online.
Categoría: ${meta.category || "no especificada"}
Talla: ${meta.size || "no especificada"}
Estado: ${meta.condition || "no especificado"}
Precio: $${meta.price} CLP
No inventes marca ni materiales que no se vean claramente en la foto. No uses emojis. No repitas el precio en el texto.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: mimeType, data: imageBase64 } },
              { text: prompt },
            ],
          },
        ],
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Gemini (texto) devolvió ${res.status}: ${await res.text()}`);
  }
  const responseJson = await res.json();
  const parts = responseJson?.candidates?.[0]?.content?.parts ?? [];
  // deno-lint-ignore no-explicit-any
  const text = parts.find((p: any) => typeof p.text === "string")?.text ?? "";
  return text.trim();
}

async function uploadImage(path: string, base64: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

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

    // 1) Foto original tal cual la subió el admin
    const originalUrl = await uploadImage(`${itemId}/original.${ext}`, imageBase64, mimeType);

    // 2) Foto "mejorada": misma prenda, mejor luz y fondo
    const enhanced = await callGeminiImage(
      "Mejora esta foto de una prenda de ropa para un catálogo de venta online: corrige la iluminación y el balance de color, deja un fondo limpio y neutro (blanco o gris claro), sin recortar ni deformar la prenda, sin agregar logos ni texto, sin inventar detalles que no estén en la foto original.",
      imageBase64,
      mimeType
    );
    const enhancedUrl = await uploadImage(`${itemId}/enhanced.png`, enhanced.data, enhanced.mimeType);

    // 3) Variante 1: estilo flat lay
    const variant1 = await callGeminiImage(
      "A partir de esta foto, genera una presentación de la misma prenda en estilo 'flat lay': extendida prolijamente sobre una superficie neutra clara, vista cenital, buena iluminación de estudio, sin agregar objetos ni texto, manteniendo el mismo color, estampado y diseño de la prenda original.",
      imageBase64,
      mimeType
    );
    const variant1Url = await uploadImage(`${itemId}/variant1.png`, variant1.data, variant1.mimeType);

    // 4) Variante 2: en maniquí / perchero
    const variant2 = await callGeminiImage(
      "A partir de esta foto, genera una presentación de la misma prenda puesta en un maniquí o colgada en un perchero neutro, con un fondo desenfocado tipo vitrina de tienda, manteniendo el mismo color, estampado y diseño de la prenda original, sin agregar texto ni logos.",
      imageBase64,
      mimeType
    );
    const variant2Url = await uploadImage(`${itemId}/variant2.png`, variant2.data, variant2.mimeType);

    // 5) Descripción de venta
    const description = await callGeminiDescription(imageBase64, mimeType, {
      price: String(price),
      category,
      size,
      condition,
    });

    // 6) Guardar como borrador para que lo revises antes de publicar
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
        photo_enhanced: enhancedUrl,
        photo_variant_1: variant1Url,
        photo_variant_2: variant2Url,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return json({ item });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Error desconocido";
    return json({ error: message }, 500);
  }
});
