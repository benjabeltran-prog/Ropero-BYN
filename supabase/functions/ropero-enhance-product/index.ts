// ============================================================
// Edge Function: ropero-enhance-product
// ------------------------------------------------------------
// Recibe la foto de una prenda + datos básicos (precio, categoría,
// talla, estado) y:
//   1) prepara una segunda copia de la foto: corrige la rotación EXIF y
//      la redimensiona si es muy grande (sin tocar el color — ver la nota
//      en enhancePhoto() más abajo sobre por qué se sacó el auto-niveles)
//   2) escribe una descripción factual con Gemini, mirando la foto (texto,
//      gratis)
// Sube las 2 imágenes a Storage y crea la fila en "items" con estado
// "borrador" para que la revises antes de publicar. En el catálogo y el
// admin se muestra la foto ORIGINAL como principal.
//
// Variables de entorno necesarias (se configuran al desplegar,
// ver SETUP.md):
//   GEMINI_API_KEY
// (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen inyectadas
// automáticamente por Supabase en toda Edge Function)
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "jsr:@matmen/imagescript@1.3.1";
import { buildDescription, callGeminiVisualFields } from "../_shared/gemini-description.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "ropero-photos";

const MAX_DIMENSION = 1600; // ancho/alto máximo de la foto mejorada

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

// Lee el tag EXIF Orientation (0x0112) directo de los bytes del JPEG.
// Los celulares guardan la foto "cruda" como la ve el sensor y anotan en
// este tag cómo hay que rotarla para verla bien — el navegador/celular lo
// aplica solo al mostrar la foto original, pero `Image.decode()` de
// imagescript lo ignora: decodifica los píxeles crudos tal cual. Si no
// corregimos esto antes de re-codificar, la foto "mejorada" pierde esa
// rotación implícita y queda girada. Devuelve 1 (normal) si no hay tag.
function readExifOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1; // no es JPEG

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const segLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker === 0xe1) {
      // APP1 — puede contener "Exif\0\0"
      const segStart = offset + 4;
      if (
        bytes[segStart] === 0x45 && bytes[segStart + 1] === 0x78 &&
        bytes[segStart + 2] === 0x69 && bytes[segStart + 3] === 0x66 &&
        bytes[segStart + 4] === 0x00 && bytes[segStart + 5] === 0x00
      ) {
        const tiffStart = segStart + 6;
        const little = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49; // "II"
        const readU16 = (p: number) => little ? bytes[p] | (bytes[p + 1] << 8) : (bytes[p] << 8) | bytes[p + 1];
        const readU32 = (p: number) => little
          ? (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)) >>> 0
          : ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;

        const ifdOffset = readU32(tiffStart + 4);
        const ifdStart = tiffStart + ifdOffset;
        const entryCount = readU16(ifdStart);
        for (let i = 0; i < entryCount; i++) {
          const entryOffset = ifdStart + 2 + i * 12;
          const tag = readU16(entryOffset);
          if (tag === 0x0112) {
            const value = readU16(entryOffset + 8);
            return value >= 1 && value <= 8 ? value : 1;
          }
        }
      }
    }
    if (marker === 0xda) break; // Start of Scan: se acabó el header
    offset += 2 + segLength;
  }
  return 1;
}

// Aplica la rotación/espejo que le corresponde a cada valor de Orientation
// (probado contra los 8 valores estándar de EXIF, comparando pixel a pixel
// contra PIL/ImageOps.exif_transpose como referencia).
function applyExifOrientation(image: Image, orientation: number) {
  switch (orientation) {
    case 2: image.flip("horizontal"); break;
    case 3: image.rotate(180); break;
    case 4: image.flip("vertical"); break;
    case 5: image.rotate(270); image.flip("horizontal"); break;
    case 6: image.rotate(270); break;
    case 7: image.rotate(90); image.flip("horizontal"); break;
    case 8: image.rotate(90); break;
    default: break; // 1 = normal, nada que hacer
  }
}

// NOTA: acá antes había un "auto niveles" que estiraba el contraste de la
// foto automáticamente. Se sacó por completo: tanto la versión por canal
// (R/G/B por separado) como una versión posterior que solo tocaba la
// luminancia terminaban distorsionando el color real de la prenda —
// cualquier estiramiento de histograma de toda la foto puede "aplastar"
// una prenda de color sólido y distinto al fondo (que es prácticamente
// siempre el caso acá), porque el algoritmo no sabe distinguir "la prenda"
// de "el fondo": solo ve un histograma. Se probó con fotos reales y en
// ambos casos el color de la prenda quedaba mal. Mejor no arriesgar el
// color: esta función ahora SOLO corrige la rotación EXIF y redimensiona
// si la foto es muy grande — ninguna de las dos toca un solo pixel de color.
async function enhancePhoto(originalBytes: Uint8Array): Promise<Uint8Array> {
  const orientation = readExifOrientation(originalBytes);
  const image = await Image.decode(originalBytes);

  // Corrige la rotación ANTES de todo lo demás: encodeJPEG no guarda EXIF,
  // así que si no aplicamos esto acá la corrección se pierde para siempre.
  applyExifOrientation(image, orientation);

  if (image.width > MAX_DIMENSION || image.height > MAX_DIMENSION) {
    if (image.width >= image.height) {
      image.resize(MAX_DIMENSION, Image.RESIZE_AUTO);
    } else {
      image.resize(Image.RESIZE_AUTO, MAX_DIMENSION);
    }
  }

  return await image.encodeJPEG(92);
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

    // 1) Foto original tal cual la subió el admin
    const originalUrl = await uploadImage(`${itemId}/original.${ext}`, originalBytes, mimeType);

    // 2) Foto "mejorada": auto-corrección de niveles/contraste (gratis, sin IA)
    const enhancedBytes = await enhancePhoto(originalBytes);
    const enhancedUrl = await uploadImage(`${itemId}/enhanced.jpg`, enhancedBytes, "image/jpeg");

    // 3) Descripción: marca/material/color los identifica Gemini mirando la
    // foto (gratis, solo texto); talla y estado son los que ya escribió el
    // admin. El resultado es una descripción factual, no un texto de venta.
    const aiFieldsRaw = await callGeminiVisualFields(imageBase64, mimeType);
    const description = buildDescription(aiFieldsRaw, { size, condition });

    // 4) Guardar como borrador para que lo revises antes de publicar
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
