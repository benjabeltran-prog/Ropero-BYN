import { supabase } from "./supabaseClient.js";

const grid = document.getElementById("grid");
const emptyState = document.getElementById("empty-state");
const filtersEl = document.getElementById("filters");
const sizeFiltersEl = document.getElementById("size-filters");
const detailRoot = document.getElementById("detail-root");
const toastRoot = document.getElementById("toast-root");
const shareCatalogBtn = document.getElementById("share-catalog-btn");

const money = (n) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);

const NEW_WINDOW_MS = 4 * 24 * 60 * 60 * 1000; // "Nuevo" mientras tenga menos de 4 días publicada
const WHATSAPP_ICON = `<svg class="wa-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.7-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.4-1.5-.9-.8-1.5-1.8-1.6-2.1-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.3-.5.1-.2 0-.4 0-.5C10 9 9.5 7.7 9.3 7.2c-.2-.5-.4-.4-.5-.4h-.5c-.2 0-.5.1-.7.3-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.4.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.9.5 3.6 1.5 5.2L2 22l4.9-1.5c1.5.9 3.3 1.4 5.1 1.4 5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18c-1.7 0-3.3-.5-4.6-1.3l-.3-.2-3.3 1 1-3.2-.2-.3C3.9 14.6 3.3 13 3.3 11.4c0-4.8 3.9-8.6 8.7-8.6s8.7 3.9 8.7 8.6-3.9 8.6-8.7 8.6z"></path></svg>`;
const SHARE_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"></line><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"></line></svg>`;

let allItems = [];
let activeCategory = "Todas";
let activeSize = "Todas";
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
    emptyState.hidden = false;
    emptyState.querySelector(".empty-state-title").textContent = "No se pudo cargar el catálogo";
    emptyState.querySelector(".empty-state-sub").textContent = "Intenta de nuevo más tarde.";
    return;
  }

  allItems = data || [];
  renderFilters();
  renderSizeFilters();
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

function renderSizeFilters() {
  const sizes = ["Todas", ...new Set(allItems.map((i) => i.size).filter(Boolean))];
  sizeFiltersEl.innerHTML = "";
  if (sizes.length <= 2) {
    sizeFiltersEl.hidden = true;
    return;
  }
  sizeFiltersEl.hidden = false;
  sizes.forEach((size) => {
    const btn = document.createElement("button");
    btn.className = "size-chip" + (size === activeSize ? " active" : "");
    btn.textContent = size === "Todas" ? "Todas" : size;
    btn.title = size === "Todas" ? "Todas las tallas" : `Talla ${size}`;
    btn.addEventListener("click", () => {
      activeSize = size;
      renderSizeFilters();
      renderGrid();
    });
    sizeFiltersEl.appendChild(btn);
  });
}

function isNew(item) {
  if (item.status !== "disponible") return false;
  const created = new Date(item.created_at).getTime();
  return Number.isFinite(created) && Date.now() - created < NEW_WINDOW_MS;
}

function renderGrid() {
  const items = allItems.filter(
    (i) =>
      (activeCategory === "Todas" || i.category === activeCategory) &&
      (activeSize === "Todas" || i.size === activeSize)
  );

  grid.innerHTML = "";
  emptyState.hidden = items.length > 0;
  if (items.length === 0 && allItems.length > 0) {
    emptyState.querySelector(".empty-state-icon").textContent = "🔍";
    emptyState.querySelector(".empty-state-title").textContent = "No hay prendas con ese filtro";
    emptyState.querySelector(".empty-state-sub").textContent = "Prueba con otra categoría o talla.";
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
    card.innerHTML = `
      <div class="photo-wrap">
        ${badge}
        <img src="${item.photo_enhanced || item.photo_original || ""}" alt="${escapeHtml(item.title)}" loading="lazy" />
      </div>
      <div class="info">
        <div class="price">${money(item.price)}</div>
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

function openDetail(item) {
  const photos = [item.photo_enhanced, item.photo_original].filter(Boolean);

  const isAvailable = item.status === "disponible";
  const statusLabel = item.status === "reservada" ? "Reservada" : item.status === "vendida" ? "Vendida" : "";

  detailRoot.innerHTML = `
    <div class="detail-overlay" id="overlay">
      <div class="detail-sheet">
        <button class="detail-share" id="share-item-btn" aria-label="Compartir esta prenda">${SHARE_ICON}</button>
        <button class="detail-close" id="close-btn" aria-label="Cerrar">✕</button>
        <div class="gallery" id="gallery">
          ${photos.map((src) => `<img src="${src}" alt="${escapeHtml(item.title)}" />`).join("")}
          ${
            photos.length > 1
              ? `<div class="gallery-dots">${photos.map((_, i) => `<span class="dot${i === 0 ? " active" : ""}"></span>`).join("")}</div>`
              : ""
          }
        </div>
        <div class="detail-body">
          <div class="price">${money(item.price)}</div>
          <div class="meta">
            ${item.category ? `<span class="tag">${escapeHtml(item.category)}</span>` : ""}
            ${item.size ? `<span class="tag">Talla ${escapeHtml(item.size)}</span>` : ""}
            ${item.condition ? `<span class="tag">${escapeHtml(item.condition)}</span>` : ""}
            ${statusLabel ? `<span class="tag">${statusLabel}</span>` : ""}
          </div>
          ${item.description ? `<div class="description-label">Descripción</div>` : ""}
          <p class="description">${escapeHtml(item.description || "")}</p>
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

  if (photos.length > 1) {
    const galleryEl = document.getElementById("gallery");
    const dots = galleryEl.querySelectorAll(".dot");
    galleryEl.addEventListener("scroll", () => {
      const index = Math.round(galleryEl.scrollLeft / galleryEl.clientWidth);
      dots.forEach((dot, i) => dot.classList.toggle("active", i === index));
    });
  }

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
    showToast("Link copiado 📋");
  } catch {
    showToast(`Copia este link: <a href="${url}">${url}</a>`);
  }
}

function shareCatalog() {
  const url = `${location.origin}${location.pathname}`;
  shareLink(url, window.APP_CONFIG?.APP_NAME || "Ropero", "Mira mi catálogo de ropa 👗");
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
