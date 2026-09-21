// ============================================================
// Edge Function: ropero-enhance-product
// ------------------------------------------------------------
// Recibe la foto de una prenda + datos básicos (precio, categoría,
// talla, estado) y:
//   1) mejora la foto con auto-corrección de nivel/contraste por canal
//      (procesamiento de imagen clásico, GRATIS — no es IA generativa,
//      así que no inventa nada: solo estira el rango de luz y color de
//      tu foto real, igual que un "auto niveles" de Photoshop/GIMP)
//   2) escribe una descripción breve de venta con Gemini (texto, gratis)
// Sube las 2 imágenes a Storage y crea la fila en "items" con estado
// "borrador" para que la revises antes de publicar.
//
// Variables de entorno necesarias (se configuran al desplegar,
// ver SETUP.md):
//   GEMINI_API_KEY
// (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen inyectadas
// automáticamente por Supabase en toda Edge Function)
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "jsr:@matmen/imagescript@1.3.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const BUCKET = "ropero-photos";

const TEXT_MODEL = "gemini-flash-lite-latest"; // alias siempre apuntando al Flash-Lite vigente
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

function clampByte(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
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

// "Auto niveles": estira el histograma de cada canal (R, G, B) por
// separado para que use todo el rango 0-255, recortando un pequeño
// porcentaje de píxeles extremos (ruido/reflejos) para no distorsionar
// el resultado. Es el mismo tipo de corrección automática que trae
// cualquier editor de fotos — no genera contenido nuevo.
function autoLevels(image: Image, clipPercent = 1) {
  const { bitmap } = image;
  const totalPixels = image.width * image.height;
  const clip = Math.floor((totalPixels * clipPercent) / 100);

  const histR = new Uint32Array(256);
  const histG = new Uint32Array(256);
  const histB = new Uint32Array(256);

  for (let i = 0; i < bitmap.length; i += 4) {
    histR[bitmap[i]]++;
    histG[bitmap[i + 1]]++;
    histB[bitmap[i + 2]]++;
  }

  function bounds(hist: Uint32Array): [number, number] {
    let lo = 0;
    let acc = 0;
    for (; lo < 255; lo++) {
      acc += hist[lo];
      if (acc > clip) break;
    }
    let hi = 255;
    acc = 0;
    for (; hi > 0; hi--) {
      acc += hist[hi];
      if (acc > clip) break;
    }
    if (hi <= lo) return [0, 255];
    return [lo, hi];
  }

  const [rLo, rHi] = bounds(histR);
  const [gLo, gHi] = bounds(histG);
  const [bLo, bHi] = bounds(histB);

  const rScale = 255 / Math.max(1, rHi - rLo);
  const gScale = 255 / Math.max(1, gHi - gLo);
  const bScale = 255 / Math.max(1, bHi - bLo);

  for (let i = 0; i < bitmap.length; i += 4) {
    bitmap[i] = clampByte((bitmap[i] - rLo) * rScale);
    bitmap[i + 1] = clampByte((bitmap[i + 1] - gLo) * gScale);
    bitmap[i + 2] = clampByte((bitmap[i + 2] - bLo) * bScale);
  }
}

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

  autoLevels(image, 1);

  return await image.encodeJPEG(88);
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

    // 3) Descripción de venta (Gemini, texto — gratis)
    const description = await callGeminiDescription(imageBase64, mimeType, {
      price: String(price),
      category,
      size,
      condition,
    });

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
