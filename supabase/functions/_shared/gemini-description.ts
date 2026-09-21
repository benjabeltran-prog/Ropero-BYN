// ============================================================
// Compartido entre las Edge Functions de Ropero que generan la
// descripción de una prenda con Gemini (texto, gratis):
//   - ropero-enhance-product (prenda nueva)
//   - ropero-regenerate-description (volver a generar en una
//     prenda ya existente, borrador o publicada)
// ============================================================

const TEXT_MODEL = "gemini-flash-lite-latest"; // alias siempre apuntando al Flash-Lite vigente
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;

// Le pedimos a Gemini SOLO lo que no podemos saber sin mirar la foto: marca
// (si hay una etiqueta o logo visible), material a simple vista, y color.
// Talla y estado NO se le piden al modelo — esos ya los escribió el admin,
// así que se usan tal cual (más confiable que hacer que la IA los adivine).
export async function callGeminiVisualFields(imageBase64: string, mimeType: string) {
  const prompt = `Mira la foto de esta prenda de segunda mano y responde SOLO con estas 3 líneas, sin texto adicional antes ni después, sin emojis y sin frases de venta:
Marca: <marca si se ve con claridad en una etiqueta, logo o estampado; si no es identificable escribe "No especificada">
Material: <material más probable a simple vista, por ejemplo algodón, poliéster, denim, lana, cuero sintético; si no es identificable escribe "No especificado">
Color: <color o colores principales de la prenda>

Responde exactamente en ese formato, una etiqueta por línea, sin agregar nada más.`;

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

// Saca "Marca: Adidas" -> "Adidas" del texto que devolvió Gemini. Si por lo
// que sea no respetó el formato pedido, devuelve el fallback en vez de
// romper la publicación de la prenda.
export function extractField(rawText: string, label: string, fallback: string): string {
  const match = rawText.match(new RegExp(`${label}\\s*:\\s*(.+)`, "i"));
  const value = match ? match[1].trim().replace(/^["']|["']$/g, "") : "";
  return value || fallback;
}

// Arma la descripción final: estructurada y factual (marca / material /
// talla / color / estado), sin relleno de tono coloquial.
export function buildDescription(
  aiFieldsRaw: string,
  meta: { size?: string; condition?: string }
): string {
  const marca = extractField(aiFieldsRaw, "Marca", "No especificada");
  const material = extractField(aiFieldsRaw, "Material", "No especificado");
  const color = extractField(aiFieldsRaw, "Color", "No especificado");
  const talla = meta.size?.trim() || "No especificada";
  const estado = meta.condition?.trim() || "No especificado";

  return [
    `Marca: ${marca}`,
    `Material: ${material}`,
    `Talla: ${talla}`,
    `Color: ${color}`,
    `Estado: ${estado}`,
  ].join("\n");
}
