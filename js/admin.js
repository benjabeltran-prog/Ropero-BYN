import { supabase } from "./supabaseClient.js";

const money = (n) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);

const loginView = document.getElementById("login-view");
const adminView = document.getElementById("admin-view");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");

const photoInput = document.getElementById("photo-input");
const photoPreview = document.getElementById("photo-preview");
const generateBtn = document.getElementById("generate-btn");
const generateStatus = document.getElementById("generate-status");
const reviewRoot = document.getElementById("review-root");
const itemsList = document.getElementById("items-list");

let selectedFile = null;

const REGEN_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`;

// Vuelve a generarle la descripción a una prenda que ya existe (borrador o
// publicada), mirando de nuevo la foto con Gemini. No guarda nada — solo
// devuelve el texto para que quien esté editando decida si lo conserva.
async function regenerateDescription(imageUrl, size, condition) {
  const { data, error } = await supabase.functions.invoke("ropero-regenerate-description", {
    body: { imageUrl, size, condition },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data.description;
}

// ---------- Fotos: galería + fotos extra (agregadas a mano) ---------------
// La foto original (la que subió el admin al crear la prenda) siempre va
// primero y no se puede quitar desde acá. Además de esa, el admin puede
// agregar hasta 2 fotos extra por prenda (photo_variant_1 / photo_variant_2),
// que se suben directo a Storage desde el navegador (el admin ya está
// autenticado, así que las políticas de RLS lo permiten sin pasar por
// ninguna Edge Function).
const EXTRA_PHOTO_SLOTS = ["photo_variant_1", "photo_variant_2"];

function photosOf(item) {
  return [item.photo_original || item.photo_enhanced, item.photo_variant_1, item.photo_variant_2].filter(Boolean);
}

function galleryHtml(item, galleryId) {
  const photos = photosOf(item);
  const dots =
    photos.length > 1
      ? `<div class="gallery-dots">${photos
          .map((_, i) => `<span class="dot${i === 0 ? " active" : ""}"></span>`)
          .join("")}</div>`
      : "";
  return `
    <div class="gallery-wrap" id="${galleryId}-wrap">
      <div class="gallery" id="${galleryId}">
        ${photos.map((p) => `<img src="${p}" alt="foto de la prenda" />`).join("")}
      </div>
      ${dots}
    </div>
  `;
}

function photoManagerHtml(item, managerId) {
  const slotsHtml = EXTRA_PHOTO_SLOTS.map((slotKey) => {
    const url = item[slotKey];
    if (url) {
      return `
        <div class="extra-photo-thumb">
          <img src="${url}" alt="foto adicional" />
          <button type="button" class="extra-photo-remove" data-remove-slot="${slotKey}" aria-label="Quitar foto">×</button>
        </div>
      `;
    }
    return `
      <label class="extra-photo-add" data-add-slot="${slotKey}">
        <input type="file" accept="image/*" hidden data-file-slot="${slotKey}" />
        <span>+</span>
      </label>
    `;
  }).join("");

  return `
    <div class="field" id="${managerId}">
      <label>Fotos adicionales (opcional)</label>
      <div class="extra-photos">${slotsHtml}</div>
    </div>
  `;
}

async function uploadExtraPhoto(item, slotKey, file) {
  const ext = (file.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
  const slotNum = slotKey === "photo_variant_1" ? "1" : "2";
  const path = `${item.id}/variant${slotNum}.${ext}`;

  const { error: uploadError } = await supabase.storage.from("ropero-photos").upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: true,
  });
  if (uploadError) {
    alert("No se pudo subir la foto: " + uploadError.message);
    return false;
  }

  const { data: pub } = supabase.storage.from("ropero-photos").getPublicUrl(path);
  const url = `${pub.publicUrl}?v=${Date.now()}`; // cache-busting: el path se reutiliza al reemplazar

  const { error: updateError } = await supabase.from("items").update({ [slotKey]: url }).eq("id", item.id);
  if (updateError) {
    alert("No se pudo guardar la foto: " + updateError.message);
    return false;
  }

  item[slotKey] = url;
  return true;
}

async function removeExtraPhoto(item, slotKey) {
  const { error } = await supabase.from("items").update({ [slotKey]: null }).eq("id", item.id);
  if (error) {
    alert("No se pudo quitar la foto: " + error.message);
    return false;
  }
  item[slotKey] = null;
  return true;
}

function wireGalleryScroll(galleryId) {
  const galleryEl = document.getElementById(galleryId);
  const dotsEl = galleryEl?.nextElementSibling;
  if (!galleryEl || !dotsEl || !dotsEl.classList.contains("gallery-dots")) return;
  const dots = dotsEl.querySelectorAll(".dot");
  galleryEl.addEventListener("scroll", () => {
    const idx = Math.round(galleryEl.scrollLeft / galleryEl.clientWidth);
    dots.forEach((d, i) => d.classList.toggle("active", i === idx));
  });
}

// Conecta la galería + el administrador de fotos extra dentro de una hoja
// (Revisar o Editar). Al agregar/quitar una foto, vuelve a dibujar ambos
// bloques en el lugar para reflejar el cambio al instante.
function wireGalleryAndManager(item, galleryId, managerId) {
  wireGalleryScroll(galleryId);
  const managerEl = document.getElementById(managerId);
  if (!managerEl) return;

  const refresh = () => {
    const wrapEl = document.getElementById(`${galleryId}-wrap`);
    if (wrapEl) wrapEl.outerHTML = galleryHtml(item, galleryId);
    managerEl.outerHTML = photoManagerHtml(item, managerId);
    wireGalleryAndManager(item, galleryId, managerId);
  };

  managerEl.querySelectorAll("[data-file-slot]").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const slotKey = input.dataset.fileSlot;
      input.closest(".extra-photo-add")?.classList.add("loading");
      const ok = await uploadExtraPhoto(item, slotKey, file);
      if (ok) refresh();
      else input.closest(".extra-photo-add")?.classList.remove("loading");
    });
  });

  managerEl.querySelectorAll("[data-remove-slot]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!confirm("¿Quitar esta foto adicional?")) return;
      const slotKey = btn.dataset.removeSlot;
      const ok = await removeExtraPhoto(item, slotKey);
      if (ok) refresh();
    });
  });
}

// ---------- Auth ---------------------------------------------------------

async function checkSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    showAdmin();
  } else {
    loginView.hidden = false;
    adminView.hidden = true;
  }
}

loginBtn.addEventListener("click", async () => {
  loginError.hidden = true;
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  loginBtn.disabled = true;
  loginBtn.textContent = "Entrando…";

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  loginBtn.disabled = false;
  loginBtn.textContent = "Entrar";

  if (error) {
    loginError.textContent = "Email o contraseña incorrectos.";
    loginError.hidden = false;
    return;
  }
  showAdmin();
});

function showAdmin() {
  loginView.hidden = true;
  adminView.hidden = false;
  loadItems();
}

// ---------- Tabs -----------------------------------------------------------

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-new").hidden = tab.dataset.tab !== "new";
    document.getElementById("tab-items").hidden = tab.dataset.tab !== "items";
    document.getElementById("tab-dashboard").hidden = tab.dataset.tab !== "dashboard";
    document.getElementById("tab-settings").hidden = tab.dataset.tab !== "settings";
    if (tab.dataset.tab !== "dashboard") stopPresencePolling();
    if (tab.dataset.tab === "items") loadItems();
    if (tab.dataset.tab === "dashboard") loadDashboard();
    if (tab.dataset.tab === "settings") loadSettingsView();
  });
});

// ---------- Foto -------------------------------------------------------

photoPreview.addEventListener("click", () => photoInput.click());

photoInput.addEventListener("change", () => {
  const file = photoInput.files?.[0];
  if (!file) return;
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = () => {
    photoPreview.innerHTML = `<img src="${reader.result}" alt="Foto seleccionada" />`;
  };
  reader.readAsDataURL(file);
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // reader.result = "data:image/jpeg;base64,AAAA..."
      const base64 = reader.result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- Generar con IA ------------------------------------------------

generateBtn.addEventListener("click", async () => {
  const price = document.getElementById("price").value;
  const category = document.getElementById("category").value;
  const size = document.getElementById("size").value;
  const condition = document.getElementById("condition").value;
  const referencePriceRaw = document.getElementById("reference-price").value;
  const referencePrice = referencePriceRaw ? Number(referencePriceRaw) : null;

  if (!selectedFile) {
    showGenerateStatus("Elige primero una foto de la prenda.", true);
    return;
  }
  if (!price) {
    showGenerateStatus("Ingresa el precio.", true);
    return;
  }

  generateBtn.disabled = true;
  generateBtn.innerHTML = '<span class="spinner"></span> Generando fotos y descripción…';
  showGenerateStatus("Esto puede tardar unos 20-30 segundos, no cierres la página.", false);

  try {
    const imageBase64 = await fileToBase64(selectedFile);
    const { data, error } = await supabase.functions.invoke("ropero-enhance-product", {
      body: {
        imageBase64,
        mimeType: selectedFile.type || "image/jpeg",
        price: Number(price),
        category,
        size,
        condition,
        referencePrice,
      },
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    generateStatus.hidden = true;
    openReview(data.item);
    resetForm();
  } catch (err) {
    console.error(err);
    showGenerateStatus("No se pudo generar la prenda: " + (err.message || err), true);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Generar con IA";
  }
});

function showGenerateStatus(text, isError) {
  generateStatus.hidden = false;
  generateStatus.textContent = text;
  generateStatus.classList.toggle("error", !!isError);
}

function resetForm() {
  selectedFile = null;
  photoInput.value = "";
  photoPreview.innerHTML = "Toca para elegir una foto";
  document.getElementById("price").value = "";
  document.getElementById("size").value = "";
  document.getElementById("category").value = "";
  document.getElementById("condition").value = "";
  document.getElementById("reference-price").value = "";
}

// ---------- Revisar y publicar (borrador) ------------------------------

function openReview(item) {
  reviewRoot.innerHTML = `
    <div class="detail-overlay" id="review-overlay">
      <div class="detail-sheet">
        <button class="detail-close" id="review-close" aria-label="Cerrar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"></line><line x1="19" y1="5" x2="5" y2="19"></line></svg></button>
        ${galleryHtml(item, "review-gallery")}
        <div class="detail-body">
          <div class="status-banner">Revisa el resultado antes de publicarlo en el catálogo.</div>
          ${photoManagerHtml(item, "review-photo-manager")}
          <div class="field">
            <label>Título</label>
            <input id="review-title" type="text" value="${escapeAttr(item.title)}" />
          </div>
          <div class="field">
            <label>Precio (CLP)</label>
            <input id="review-price" type="number" value="${item.price}" />
          </div>
          <div class="field">
            <label>Precio de referencia (opcional)</label>
            <input id="review-reference-price" type="number" inputmode="numeric" placeholder="Precio original, solo si lo sabes" value="${item.reference_price || ""}" />
          </div>
          <div class="field">
            <div class="field-label-row">
              <label>Descripción</label>
              <button type="button" class="btn btn-secondary btn-small" id="review-regen-btn">${REGEN_ICON} Regenerar con IA</button>
            </div>
            <textarea id="review-description">${item.description || ""}</textarea>
          </div>
        </div>
      </div>
    </div>
    <div class="reserve-bar" style="display:flex; gap:10px;">
      <button class="btn btn-secondary" id="discard-btn">Descartar</button>
      <button class="btn btn-primary" id="publish-btn">Publicar</button>
    </div>
  `;

  document.getElementById("review-close").addEventListener("click", closeReview);
  document.getElementById("review-overlay").addEventListener("click", (e) => {
    if (e.target.id === "review-overlay") closeReview();
  });
  wireGalleryAndManager(item, "review-gallery", "review-photo-manager");

  document.getElementById("review-regen-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Generando…`;
    try {
      const imageUrl = item.photo_original || item.photo_enhanced;
      const description = await regenerateDescription(imageUrl, item.size, item.condition);
      document.getElementById("review-description").value = description;
    } catch (err) {
      alert("No se pudo regenerar la descripción: " + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${REGEN_ICON} Regenerar con IA`;
    }
  });

  document.getElementById("discard-btn").addEventListener("click", async () => {
    await supabase.from("items").delete().eq("id", item.id);
    closeReview();
    loadItems();
  });

  document.getElementById("publish-btn").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Publicando…";
    const title = document.getElementById("review-title").value.trim();
    const price = Number(document.getElementById("review-price").value);
    const description = document.getElementById("review-description").value.trim();
    const referencePriceRaw = document.getElementById("review-reference-price").value;
    const reference_price = referencePriceRaw ? Number(referencePriceRaw) : null;

    const { error } = await supabase
      .from("items")
      .update({ title, price, description, reference_price, status: "disponible" })
      .eq("id", item.id);

    if (error) {
      alert("No se pudo publicar: " + error.message);
      e.target.disabled = false;
      e.target.textContent = "Publicar";
      return;
    }
    closeReview();
    loadItems();
    document.querySelector('.tab[data-tab="items"]').click();
  });
}

function closeReview() {
  reviewRoot.innerHTML = "";
}

function escapeAttr(str) {
  return (str || "").replace(/"/g, "&quot;");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function selectOptions(options, current) {
  return (
    `<option value="">—</option>` +
    options.map((o) => `<option ${o === current ? "selected" : ""}>${o}</option>`).join("")
  );
}

// ---------- Editar prenda ya publicada -------------------------------------

function openEdit(item) {
  reviewRoot.innerHTML = `
    <div class="detail-overlay" id="edit-overlay">
      <div class="detail-sheet">
        <button class="detail-close" id="edit-close" aria-label="Cerrar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"></line><line x1="19" y1="5" x2="5" y2="19"></line></svg></button>
        ${galleryHtml(item, "edit-gallery")}
        <div class="detail-body">
          <div class="status-banner">Editando "${escapeAttr(item.title)}"</div>
          ${photoManagerHtml(item, "edit-photo-manager")}
          <div class="field">
            <label for="edit-title">Título</label>
            <input id="edit-title" type="text" value="${escapeAttr(item.title)}" />
          </div>
          <div class="row-2">
            <div class="field">
              <label for="edit-price">Precio (CLP)</label>
              <input id="edit-price" type="number" inputmode="numeric" value="${item.price}" />
            </div>
            <div class="field">
              <label for="edit-category">Categoría</label>
              <select id="edit-category">${selectOptions(["Mujer", "Hombre", "Niños", "Accesorios", "Calzado"], item.category)}</select>
            </div>
          </div>
          <div class="field">
            <label for="edit-reference-price">Precio de referencia (opcional)</label>
            <input id="edit-reference-price" type="number" inputmode="numeric" placeholder="Precio original, solo si lo sabes" value="${item.reference_price || ""}" />
          </div>
          <div class="row-2">
            <div class="field">
              <label for="edit-size">Talla</label>
              <input id="edit-size" type="text" placeholder="M, 38, única…" value="${escapeAttr(item.size || "")}" />
            </div>
            <div class="field">
              <label for="edit-condition">Estado</label>
              <select id="edit-condition">${selectOptions(["Nuevo con etiqueta", "Como nuevo", "Buen estado", "Con detalles"], item.condition)}</select>
            </div>
          </div>
          <div class="field">
            <div class="field-label-row">
              <label for="edit-description">Descripción</label>
              <button type="button" class="btn btn-secondary btn-small" id="edit-regen-btn">${REGEN_ICON} Regenerar con IA</button>
            </div>
            <textarea id="edit-description">${item.description || ""}</textarea>
          </div>
        </div>
      </div>
    </div>
    <div class="reserve-bar" style="display:flex; gap:10px;">
      <button class="btn btn-secondary" id="edit-cancel-btn">Cancelar</button>
      <button class="btn btn-primary" id="edit-save-btn">Guardar cambios</button>
    </div>
  `;

  document.getElementById("edit-regen-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Generando…`;
    try {
      const imageUrl = item.photo_original || item.photo_enhanced;
      // Usa la talla/estado que están escritos AHORA en el formulario (por
      // si se acaban de corregir), no los que tenía la prenda al abrir esto.
      const size = document.getElementById("edit-size").value.trim();
      const condition = document.getElementById("edit-condition").value;
      const description = await regenerateDescription(imageUrl, size, condition);
      document.getElementById("edit-description").value = description;
    } catch (err) {
      alert("No se pudo regenerar la descripción: " + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${REGEN_ICON} Regenerar con IA`;
    }
  });

  document.getElementById("edit-close").addEventListener("click", closeReview);
  document.getElementById("edit-cancel-btn").addEventListener("click", closeReview);
  document.getElementById("edit-overlay").addEventListener("click", (e) => {
    if (e.target.id === "edit-overlay") closeReview();
  });
  wireGalleryAndManager(item, "edit-gallery", "edit-photo-manager");

  document.getElementById("edit-save-btn").addEventListener("click", async (e) => {
    const title = document.getElementById("edit-title").value.trim();
    const price = Number(document.getElementById("edit-price").value);
    const category = document.getElementById("edit-category").value;
    const size = document.getElementById("edit-size").value.trim();
    const condition = document.getElementById("edit-condition").value;
    const description = document.getElementById("edit-description").value.trim();
    const referencePriceRaw = document.getElementById("edit-reference-price").value;
    const reference_price = referencePriceRaw ? Number(referencePriceRaw) : null;

    if (!title || !price) {
      alert("Completa al menos el título y el precio.");
      return;
    }

    e.target.disabled = true;
    e.target.textContent = "Guardando…";

    const { error } = await supabase
      .from("items")
      .update({ title, price, category, size, condition, description, reference_price })
      .eq("id", item.id);

    if (error) {
      alert("No se pudieron guardar los cambios: " + error.message);
      e.target.disabled = false;
      e.target.textContent = "Guardar cambios";
      return;
    }
    closeReview();
    loadItems();
  });
}

// ---------- Listado / gestión ---------------------------------------------

async function loadItems() {
  const { data, error } = await supabase.from("items").select("*").order("created_at", { ascending: false });

  if (error) {
    itemsList.innerHTML = `<div class="status-banner error">No se pudo cargar: ${error.message}</div>`;
    return;
  }

  if (!data.length) {
    itemsList.innerHTML = `<div class="empty-state">Aún no has generado ninguna prenda.</div>`;
    return;
  }

  itemsList.innerHTML = data.map(rowHtml).join("");

  data.forEach((item) => {
    const row = document.getElementById(`row-${item.id}`);
    if (!row) return;
    row.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => handleAction(btn.dataset.action, item));
    });
  });
}

function statusLabel(status) {
  return { borrador: "Borrador", disponible: "Disponible", reservada: "Reservada", vendida: "Vendida" }[status] || status;
}

function rowHtml(item) {
  const photo = item.photo_original || item.photo_enhanced || "";
  return `
    <div class="item-row" id="row-${item.id}">
      <div class="item-row-main">
        <img src="${photo}" alt="" />
        <div class="info">
          <div class="name">${item.title}</div>
          <div class="sub">${money(item.price)} · ${statusLabel(item.status)}</div>
        </div>
      </div>
      <div class="actions">
        ${item.status === "borrador" ? `<button class="btn btn-secondary btn-small" data-action="review">Revisar</button>` : ""}
        ${item.status !== "borrador" ? `<button class="btn btn-secondary btn-small" data-action="editar">Editar</button>` : ""}
        ${item.status === "reservada" ? `<button class="btn btn-secondary btn-small" data-action="vendida">Vendida</button>` : ""}
        ${item.status === "reservada" ? `<button class="btn btn-secondary btn-small" data-action="liberar">Liberar</button>` : ""}
        ${item.status === "disponible" ? `<button class="btn btn-secondary btn-small" data-action="vendida">Vendida</button>` : ""}
        ${item.status === "vendida" ? `<button class="btn btn-secondary btn-small" data-action="reactivar">Publicar de nuevo</button>` : ""}
        <button class="btn btn-danger btn-small" data-action="eliminar">Eliminar</button>
      </div>
    </div>
  `;
}

async function handleAction(action, item) {
  if (action === "review") {
    openReview(item);
    return;
  }
  if (action === "editar") {
    openEdit(item);
    return;
  }
  if (action === "vendida") {
    await supabase.from("items").update({ status: "vendida", sold_at: new Date().toISOString() }).eq("id", item.id);
  }
  if (action === "liberar") {
    await supabase.from("items").update({ status: "disponible", reserved_at: null }).eq("id", item.id);
  }
  if (action === "reactivar") {
    // La venta no se concretó: vuelve a quedar disponible en el catálogo.
    await supabase.from("items").update({ status: "disponible", reserved_at: null, sold_at: null }).eq("id", item.id);
  }
  if (action === "eliminar") {
    if (!confirm(`¿Eliminar "${item.title}"? Esta acción no se puede deshacer.`)) return;
    await supabase.from("items").delete().eq("id", item.id);
  }
  loadItems();
}

// ---------- Dashboard --------------------------------------------------------
// Números simples calculados a partir de las prendas que ya existen — sin
// tracking de vistas ni nada aparte, todo sale de la misma tabla items.

const dashboardRoot = document.getElementById("dashboard-root");

// "Navegando ahora": cuenta heartbeats recientes de ropero.presence (ver
// heartbeat() en el catálogo). Una sesión se considera activa si mandó un
// heartbeat en el último minuto (el catálogo manda uno cada 20s).
const ACTIVE_WINDOW_MS = 60 * 1000;
const ACTIVE_POLL_MS = 15 * 1000;
let presencePollTimer = null;

function daysBetween(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / (24 * 60 * 60 * 1000);
}

function liveNowHtml(count) {
  return `
    <div class="dash-live">
      <span class="dash-live-dot" aria-hidden="true"></span>
      <span class="dash-live-value" id="dash-live-value">${count === null ? "—" : count}</span>
      <span class="dash-live-label">navegando el catálogo ahora</span>
    </div>
  `;
}

async function fetchActiveNow() {
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
  const { count, error } = await supabase
    .from("presence")
    .select("session_id", { count: "exact", head: true })
    .gte("last_seen", cutoff);
  if (error) {
    console.error(error);
    return null;
  }
  return count ?? 0;
}

async function refreshActiveNow() {
  const count = await fetchActiveNow();
  const valueEl = document.getElementById("dash-live-value");
  if (valueEl) valueEl.textContent = count === null ? "—" : count;
}

function stopPresencePolling() {
  if (presencePollTimer) {
    clearInterval(presencePollTimer);
    presencePollTimer = null;
  }
}

function startPresencePolling() {
  stopPresencePolling();
  presencePollTimer = setInterval(refreshActiveNow, ACTIVE_POLL_MS);
}

function statTileHtml(value, label) {
  return `
    <div class="dash-tile">
      <div class="dash-tile-value">${value}</div>
      <div class="dash-tile-label">${label}</div>
    </div>
  `;
}

function categoryBarsHtml(counts) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    return `<p class="settings-hint">Todavía no hay ventas registradas para desglosar por categoría.</p>`;
  }
  const max = entries[0][1];
  return `
    <div class="dash-bars">
      ${entries
        .map(
          ([category, count]) => `
            <div class="dash-bar-row">
              <div class="dash-bar-label">
                <span>${escapeHtml(category)}</span>
                <span class="dash-bar-count">${count}</span>
              </div>
              <div class="dash-bar-track">
                <div class="dash-bar-fill" style="width:${Math.max(6, Math.round((count / max) * 100))}%"></div>
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

async function loadDashboard() {
  dashboardRoot.innerHTML = `<div class="status-banner">Cargando…</div>`;

  const { data, error } = await supabase
    .from("items")
    .select("id, status, price, category, created_at, sold_at");

  if (error) {
    dashboardRoot.innerHTML = `<div class="status-banner error">No se pudo cargar: ${error.message}</div>`;
    return;
  }

  const items = data || [];
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const active = items.filter((i) => i.status === "disponible" || i.status === "reservada");
  const activeValue = active.reduce((sum, i) => sum + (i.price || 0), 0);

  const sold = items.filter((i) => i.status === "vendida");
  const soldThisMonth = sold.filter((i) => i.sold_at && new Date(i.sold_at) >= monthStart);
  const soldThisMonthRevenue = soldThisMonth.reduce((sum, i) => sum + (i.price || 0), 0);

  const soldWithDates = sold.filter((i) => i.sold_at && i.created_at);
  const avgDays = soldWithDates.length
    ? soldWithDates.reduce((sum, i) => sum + daysBetween(i.created_at, i.sold_at), 0) / soldWithDates.length
    : null;

  const borradores = items.filter((i) => i.status === "borrador").length;

  const categoryCounts = {};
  sold.forEach((i) => {
    const cat = i.category || "Sin categoría";
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });

  dashboardRoot.innerHTML = `
    ${liveNowHtml(null)}
    <div class="dash-grid">
      ${statTileHtml(active.length, "Prendas activas")}
      ${statTileHtml(money(activeValue), "Valor en catálogo")}
      ${statTileHtml(soldThisMonth.length, "Vendidas este mes")}
      ${statTileHtml(money(soldThisMonthRevenue), "Ingresos este mes")}
      ${statTileHtml(avgDays !== null ? `${avgDays.toFixed(1)} días` : "—", "Tiempo prom. hasta la venta")}
      ${statTileHtml(borradores, "Borradores por revisar")}
    </div>
    <div class="dash-section-title">Vendidas por categoría</div>
    ${categoryBarsHtml(categoryCounts)}
  `;

  refreshActiveNow();
  startPresencePolling();
}

// ---------- Ajustes ---------------------------------------------------------
// Configuración de la app editable sin tocar código (fila única en
// ropero.settings). Por ahora solo el número de WhatsApp del botón
// "Reservar por WhatsApp" del catálogo.

const settingsWhatsappInput = document.getElementById("settings-whatsapp");
const settingsReservationHoursInput = document.getElementById("settings-reservation-hours");
const settingsStatus = document.getElementById("settings-status");
const settingsSaveBtn = document.getElementById("settings-save-btn");

function showSettingsStatus(text, isError) {
  settingsStatus.hidden = false;
  settingsStatus.textContent = text;
  settingsStatus.classList.toggle("error", !!isError);
}

async function loadSettingsView() {
  settingsWhatsappInput.value = "";
  settingsReservationHoursInput.value = "";
  showSettingsStatus("Cargando…", false);
  const { data, error } = await supabase
    .from("settings")
    .select("whatsapp_number, reservation_hours")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    showSettingsStatus("No se pudo cargar la configuración: " + error.message, true);
    return;
  }
  settingsWhatsappInput.value = data?.whatsapp_number || "";
  settingsReservationHoursInput.value = data?.reservation_hours ?? 4;
  settingsStatus.hidden = true;
}

settingsSaveBtn.addEventListener("click", async () => {
  const whatsapp_number = settingsWhatsappInput.value.trim();
  if (!/^\d{8,15}$/.test(whatsapp_number)) {
    showSettingsStatus("Ingresa un número válido: solo dígitos, formato internacional (ej: 56912345678).", true);
    return;
  }

  const reservation_hours = Number(settingsReservationHoursInput.value);
  if (!Number.isInteger(reservation_hours) || reservation_hours < 1 || reservation_hours > 168) {
    showSettingsStatus("Ingresa un número de horas válido (entre 1 y 168).", true);
    return;
  }

  settingsSaveBtn.disabled = true;
  settingsSaveBtn.textContent = "Guardando…";

  const { error } = await supabase
    .from("settings")
    .update({ whatsapp_number, reservation_hours, updated_at: new Date().toISOString() })
    .eq("id", 1);

  settingsSaveBtn.disabled = false;
  settingsSaveBtn.textContent = "Guardar";

  if (error) {
    showSettingsStatus("No se pudo guardar: " + error.message, true);
    return;
  }
  showSettingsStatus("Listo, se guardaron los cambios.", false);
});

// ---------- Init -----------------------------------------------------------

checkSession();
