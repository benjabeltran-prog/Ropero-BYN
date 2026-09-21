// ============================================================
// Edge Function: ropero-regenerate-description
// ------------------------------------------------------------
// Vuelve a generar la descripción de una prenda que YA existe
// (borrador o ya publicada), sin tocar sus fotos ni crear una
// fila nueva. Útil cuando la descripción original no quedó bien
// o cuando se corrige la talla/estado y se quiere que la
// descripción lo refleje.
//
// Recibe la URL de la foto (la que ya está en Storage) + talla y
// estado actuales, y devuelve solo el texto de la nueva
// descripción — no guarda nada en la base de datos, así el admin
// puede revisarla/editarla antes de guardar los cambios.
//
// Variables de entorno necesarias: GEMINI_API_KEY
// ============================================================

import { buildDescription, callGeminiVisualFields } from "../_shared/gemini-description.ts";

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

// Descarga la foto ya subida a Storage y la deja en base64 para
// mandársela a Gemini (misma foto que se usó/verá en el catálogo,
// no hace falta que el navegador la vuelva a subir).
async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`No se pudo descargar la foto (${res.status})`);
  }
  const mimeType = res.headers.get("content-type") || "image/jpeg";
  const bytes = new Uint8Array(await res.arrayBuffer());

  // atob/btoa trabajan con strings, así que convertimos en trozos para no
  // reventar el límite de argumentos de String.fromCharCode con fotos grandes.
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);

  return { base64, mimeType };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const body = await req.json();
    const { imageUrl, size, condition } = body ?? {};

    if (!imageUrl) {
      return json({ error: "Falta imageUrl" }, 400);
    }

    const { base64, mimeType } = await fetchImageAsBase64(imageUrl);
    const aiFieldsRaw = await callGeminiVisualFields(base64, mimeType);
    const description = buildDescription(aiFieldsRaw, { size, condition });

    return json({ description });
  } catch (err) {
    console.error(err);
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
