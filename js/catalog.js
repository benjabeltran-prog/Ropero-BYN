import { supabase } from "./supabaseClient.js";

const grid = document.getElementById("grid");
const emptyState = document.getElementById("empty-state");
const filtersEl = document.getElementById("filters");
const detailRoot = document.getElementById("detail-root");
const toastRoot = document.getElementById("toast-root");
const shareCatalogBtn = document.getElementById("share-catalog-btn");

const money = (n) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);

const NEW_WINDOW_MS = 4 * 24 * 60 * 60 * 1000; // "Nuevo" mientras tenga menos de 4 días publicada
const WHATSAPP_ICON = `<svg class="wa-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.7-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.4-1.5-.9-.8-1.5-1.8-1.6-2.1-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.3-.5.1-.2 0-.4 0-.5C10 9 9.5 7.7 9.3 7.2c-.2-.5-.4-.4-.5-.4h-.5c-.2 0-.5.1-.7.3-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.4.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.9.5 3.6 1.5 5.2L2 22l4.9-1.5c1.5.9 3.3 1.4 5.1 1.4 5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18c-1.7 0-3.3-.5-4.6-1.3l-.3-.2-3.3 1 1-3.2-.2-.3C3.9 14.6 3.3 13 3.3 11.4c0-4.8 3.9-8.6 8.7-8.6s8.7 3.9 8.7 8.6-3.9 8.6-8.7 8.6z"></path></svg>`;
const SHARE_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"></line><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"></line></svg>`;
const CHECK_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M8 12.3 10.6 15 16 9.3"></path></svg>`;
const CLOSE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"></line><line x1="19" y1="5" x2="5" y2="19"></line></svg>`;

const EMPTY_ICON_DEFAULT = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 6.5a2.5 2.5 0 0 1 5 0"></path><path d="M12 6.5v2"></path><path d="M12 8.5 4.2 13.8a1.7 1.7 0 0 0 1 3.1h13.6a1.7 1.7 0 0 0 1-3.1L12 8.5Z"></path><path d="M6 19.5h12"></path></svg>`;
const EMPTY_ICON_SEARCH = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
const EMPTY_ICON_ERROR = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3Z"></path><line x1="12" y1="9.3" x2="12" y2="14"></line><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"></circle></svg>`;

function showEmptyState(icon, title, sub) {
  emptyState.hidden = false;
  emptyState.querySelector(".empty-state-icon").innerHTML = icon;
  emptyState.querySelector(".empty-state-title").textContent = title;
  emptyState.querySelector(".empty-state-sub").textContent = sub;
}

let allItems = [];
let activeCategory = "Todas";
let sharedItemHandled = false;

renderSkeleton();

async function loadItems() {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .in("status", ["disponible", "reservada"])
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    grid.innerHTML = "";
    showEmptyState(EMPTY_ICON_ERROR, "No se pudo cargar el catálogo", "Intenta de nuevo más tarde.");
    return;
  }

  allItems = data || [];
  renderFilters();
  renderGrid();
  maybeOpenSharedItem();
}

function renderSkeleton() {
  grid.innerHTML = Array.from({ length: 4 })
    .map(
      () => `
        <div class="skeleton-card">
          <div class="photo-wrap skeleton-shimmer"></div>
          <div class="skeleton-line skeleton-shimmer"></div>
          <div class="skeleton-line short skeleton-shimmer"></div>
        </div>
      `
    )
    .join("");
}

function renderFilters() {
  const categories = ["Todas", ...new Set(allItems.map((i) => i.category).filter(Boolean))];
  filtersEl.innerHTML = "";
  if (categories.length <= 2) {
    filtersEl.hidden = true;
    return;
  }
  filtersEl.hidden = false;
  categories.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = "filter-chip" + (cat === activeCategory ? " active" : "");
    btn.textContent = cat;
    btn.addEventListener("click", () => {
      activeCategory = cat;
      renderFilters();
      renderGrid();
    });
    filtersEl.appendChild(btn);
  });
}

function isNew(item) {
  if (item.status !== "disponible") return false;
  const created = new Date(item.created_at).getTime();
  return Number.isFinite(created) && Date.now() - created < NEW_WINDOW_MS;
}

// Hash simple y estable a partir del id de la prenda: el mismo id siempre
// da el mismo número, así el % de descuento de cada prenda no cambia entre
// recargas, pero es distinto de una prenda a otra (no se ve "clonado").
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// Precio "antes" tachado + % de descuento. Si el admin cargó un precio de
// referencia real (el precio "antes" verdadero, cuando lo conoce), el %
// se calcula a partir de ese valor real. Si no, se simula un % parejo
// (50%–70%, distinto por prenda pero estable) a partir del precio real de
// venta, nunca al revés.
function discountInfo(item) {
  if (item.reference_price && item.reference_price > item.price) {
    const pct = Math.round((1 - item.price / item.reference_price) * 100);
    return { pct, original: item.reference_price };
  }
  const pct = 50 + (hashString(item.id) % 21); // 50–70 inclusive
  const rawOriginal = item.price / (1 - pct / 100);
  const original = Math.round(rawOriginal / 500) * 500; // redondeado a $500 más cercano
  return { pct, original };
}

function priceBlockHtml(item, { size = "" } = {}) {
  const { pct, original } = discountInfo(item);
  return `
    <div class="price-row${size === "lg" ? " lg" : ""}">
      <span class="price">${money(item.price)}</span>
      <span class="discount-pct">-${pct}%</span>
    </div>
    <div class="price-original${size === "lg" ? " lg" : ""}">${money(original)}</div>
  `;
}

function renderGrid() {
  const items = allItems.filter((i) => activeCategory === "Todas" || i.category === activeCategory);

  grid.innerHTML = "";

  if (items.length > 0) {
    emptyState.hidden = true;
  } else if (allItems.length > 0) {
    showEmptyState(EMPTY_ICON_SEARCH, "No hay prendas con ese filtro", "Prueba con otra categoría.");
  } else {
    showEmptyState(
      EMPTY_ICON_DEFAULT,
      "Todavía no hay prendas publicadas",
      "Vuelve pronto, se sube ropa nueva seguido."
    );
  }

  items.forEach((item) => {
    const card = document.createElement("button");
    card.className = "card";
    const badge =
      item.status === "reservada"
        ? '<span class="badge reservada">Reservada</span>'
        : isNew(item)
        ? '<span class="badge new">Nuevo</span>'
        : "";
    const discountBadge = `<span class="badge discount">-${discountInfo(item).pct}%</span>`;
    card.innerHTML = `
      <div class="photo-wrap">
        ${badge}
        ${discountBadge}
        <img src="${item.photo_original || item.photo_enhanced || ""}" alt="${escapeHtml(item.title)}" loading="lazy" />
      </div>
      <div class="info">
        ${priceBlockHtml(item)}
        <div class="title">${escapeHtml(item.title)}</div>
      </div>
    `;
    card.addEventListener("click", () => openDetail(item));
    grid.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function itemUrl(item) {
  const base = `${location.origin}${location.pathname}`;
  return `${base}?item=${item.id}`;
}

// Foto principal (la original que subió el admin) + hasta dos fotos extra
// que el admin haya agregado a mano desde el panel de administración.
function photosOf(item) {
  return [item.photo_original || item.photo_enhanced, item.photo_variant_1, item.photo_variant_2].filter(Boolean);
}

function galleryHtml(item) {
  const photos = photosOf(item);
  const dots =
    photos.length > 1
      ? `<div class="gallery-dots">${photos
          .map((_, i) => `<span class="dot${i === 0 ? " active" : ""}"></span>`)
          .join("")}</div>`
      : "";
  return `
    <div class="gallery-wrap">
      <div class="gallery" id="gallery">
        ${photos.map((p) => `<img src="${p}" alt="${escapeHtml(item.title)}" />`).join("")}
      </div>
      ${dots}
    </div>
  `;
}

function wireGallery() {
  const galleryEl = document.getElementById("gallery");
  const dotsEl = galleryEl?.nextElementSibling;
  if (!galleryEl || !dotsEl || !dotsEl.classList.contains("gallery-dots")) return;
  const dots = dotsEl.querySelectorAll(".dot");
  galleryEl.addEventListener("scroll", () => {
    const idx = Math.round(galleryEl.scrollLeft / galleryEl.clientWidth);
    dots.forEach((d, i) => d.classList.toggle("active", i === idx));
  });
}

function openDetail(item) {
  const isAvailable = item.status === "disponible";
  const statusLabel = item.status === "reservada" ? "Reservada" : item.status === "vendida" ? "Vendida" : "";

  detailRoot.innerHTML = `
    <div class="detail-overlay" id="overlay">
      <div class="detail-sheet">
        <button class="detail-share" id="share-item-btn" aria-label="Compartir esta prenda">${SHARE_ICON}</button>
        <button class="detail-close" id="close-btn" aria-label="Cerrar">${CLOSE_ICON}</button>
        ${galleryHtml(item)}
        <div class="detail-body">
          ${priceBlockHtml(item, { size: "lg" })}
          <div class="meta">
            ${item.category ? `<span class="tag">${escapeHtml(item.category)}</span>` : ""}
            ${item.size ? `<span class="tag">Talla ${escapeHtml(item.size)}</span>` : ""}
            ${item.condition ? `<span class="tag">${escapeHtml(item.condition)}</span>` : ""}
            ${statusLabel ? `<span class="tag">${statusLabel}</span>` : ""}
          </div>
          ${item.description ? `<div class="description-label">Descripción</div>` : ""}
          <p class="description">${escapeHtml(item.description || "")}</p>
          <div class="description-label">Entrega</div>
          <p class="description">La entrega se coordina directo por WhatsApp una vez confirmada la reserva.</p>
        </div>
      </div>
    </div>
    ${
      isAvailable
        ? `<div class="reserve-bar">
             <button class="btn btn-primary" id="reserve-btn">${WHATSAPP_ICON}Reservar por WhatsApp</button>
           </div>`
        : ""
    }
  `;

  document.getElementById("close-btn").addEventListener("click", closeDetail);
  document.getElementById("overlay").addEventListener("click", (e) => {
    if (e.target.id === "overlay") closeDetail();
  });
  document.getElementById("share-item-btn").addEventListener("click", () => shareItem(item));
  wireGallery();

  const reserveBtn = document.getElementById("reserve-btn");
  if (reserveBtn) {
    reserveBtn.addEventListener("click", () => reserveItem(item, reserveBtn));
  }

  history.replaceState(null, "", itemUrl(item));
}

function closeDetail() {
  detailRoot.innerHTML = "";
  history.replaceState(null, "", `${location.origin}${location.pathname}`);
}

async function reserveItem(item, btn) {
  btn.disabled = true;
  btn.textContent = "Reservando…";

  // IMPORTANTE: los navegadores (sobre todo Safari/iPhone) solo dejan abrir
  // una pestaña/redirigir si pasa DENTRO del mismo click del usuario. Si
  // primero esperamos la respuesta de Supabase (await) y recién ahí
  // intentamos ir a WhatsApp, ya "se enfrió" el click y el navegador lo
  // bloquea en silencio — no pasa nada, ni error ni redirect. Por eso acá
  // abrimos la pestaña YA, vacía, y recién después le ponemos la URL final.
  const waTab = window.open("", "_blank");

  const { data: reserved, error } = await supabase.rpc("reserve_item", { item_id: item.id });

  if (error || !reserved) {
    if (waTab) waTab.close();
    btn.disabled = false;
    btn.innerHTML = `${WHATSAPP_ICON}Reservar por WhatsApp`;
    alert(
      error
        ? "No se pudo reservar. Intenta de nuevo."
        : "Uy, justo se acaba de reservar. Prueba con otra prenda."
    );
    loadItems();
    return;
  }

  const message = `Hola! Quiero reservar: ${item.title} (${money(item.price)}). Vi la prenda en el catálogo online.`;
  const waNumber = window.APP_CONFIG.WHATSAPP_NUMBER;
  const url = `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;

  if (waTab) {
    // Pestaña abierta con éxito: la mandamos a WhatsApp.
    waTab.location.href = url;
  } else {
    // El navegador bloqueó la pestaña nueva: como último intento navegamos
    // la misma página (puede fallar igual, pero es mejor que nada) y
    // mostramos un link visible por si el redirect automático no funciona.
    window.location.href = url;
  }

  showToast(`¿No se abrió WhatsApp? <a href="${url}" target="_blank" rel="noopener">Toca aquí</a>`);

  closeDetail();
  loadItems();
}

// ---------- Compartir --------------------------------------------------

async function shareLink(url, title, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return; // el usuario canceló el share nativo
      // si falla el share nativo, seguimos al fallback de copiar
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast(`${CHECK_ICON} Link copiado`);
  } catch {
    showToast(`Copia este link: <a href="${url}">${url}</a>`);
  }
}

function shareCatalog() {
  const url = `${location.origin}${location.pathname}`;
  shareLink(url, window.APP_CONFIG?.APP_NAME || "Ropero", "Mira mi catálogo de ropa");
}

function shareItem(item) {
  const url = itemUrl(item);
  shareLink(url, item.title, `Mira esta prenda: ${item.title} (${money(item.price)})`);
}

if (shareCatalogBtn) {
  shareCatalogBtn.addEventListener("click", shareCatalog);
}

// ---------- Toasts -------------------------------------------------------

function showToast(html) {
  const existing = toastRoot.querySelector(".toast");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = html;
  toastRoot.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ---------- Link directo a una prenda (?item=id) --------------------------

function maybeOpenSharedItem() {
  if (sharedItemHandled) return;
  const params = new URLSearchParams(location.search);
  const itemId = params.get("item");
  if (!itemId) return;
  sharedItemHandled = true;
  const item = allItems.find((i) => i.id === itemId);
  if (item) {
    openDetail(item);
  } else {
    showToast("Esa prenda ya no está disponible.");
  }
}

loadItems();

// Refresca cada 30s por si alguien más reserva mientras estás mirando el catálogo
setInterval(loadItems, 30000);
