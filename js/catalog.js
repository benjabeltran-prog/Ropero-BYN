import { supabase } from "./supabaseClient.js";

const grid = document.getElementById("grid");
const emptyState = document.getElementById("empty-state");
const filtersEl = document.getElementById("filters");
const detailRoot = document.getElementById("detail-root");

const money = (n) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);

let allItems = [];
let activeCategory = "Todas";

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
    emptyState.textContent = "No se pudo cargar el catálogo. Intenta de nuevo más tarde.";
    return;
  }

  allItems = data || [];
  renderFilters();
  renderGrid();
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

function renderGrid() {
  const items =
    activeCategory === "Todas" ? allItems : allItems.filter((i) => i.category === activeCategory);

  grid.innerHTML = "";
  emptyState.hidden = items.length > 0;

  items.forEach((item) => {
    const card = document.createElement("button");
    card.className = "card";
    card.innerHTML = `
      <div class="photo-wrap">
        ${item.status === "reservada" ? '<span class="badge reservada">Reservada</span>' : ""}
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

function openDetail(item) {
  const photos = [item.photo_enhanced, item.photo_original].filter(Boolean);

  const isAvailable = item.status === "disponible";
  const statusLabel = item.status === "reservada" ? "Reservada" : item.status === "vendida" ? "Vendida" : "";

  detailRoot.innerHTML = `
    <div class="detail-overlay" id="overlay">
      <div class="detail-sheet">
        <button class="detail-close" id="close-btn" aria-label="Cerrar">✕</button>
        <div class="gallery">
          ${photos.map((src) => `<img src="${src}" alt="${escapeHtml(item.title)}" />`).join("")}
        </div>
        <div class="detail-body">
          <div class="price">${money(item.price)}</div>
          <div class="meta">
            ${item.category ? `<span class="tag">${escapeHtml(item.category)}</span>` : ""}
            ${item.size ? `<span class="tag">Talla ${escapeHtml(item.size)}</span>` : ""}
            ${item.condition ? `<span class="tag">${escapeHtml(item.condition)}</span>` : ""}
            ${statusLabel ? `<span class="tag">${statusLabel}</span>` : ""}
          </div>
          <p class="description">${escapeHtml(item.description || "")}</p>
        </div>
      </div>
    </div>
    ${
      isAvailable
        ? `<div class="reserve-bar">
             <button class="btn btn-primary" id="reserve-btn">Reservar por WhatsApp</button>
           </div>`
        : ""
    }
  `;

  document.getElementById("close-btn").addEventListener("click", closeDetail);
  document.getElementById("overlay").addEventListener("click", (e) => {
    if (e.target.id === "overlay") closeDetail();
  });

  const reserveBtn = document.getElementById("reserve-btn");
  if (reserveBtn) {
    reserveBtn.addEventListener("click", () => reserveItem(item, reserveBtn));
  }
}

function closeDetail() {
  detailRoot.innerHTML = "";
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
    btn.textContent = "Reservar por WhatsApp";
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

  showWhatsAppFallback(url);

  closeDetail();
  loadItems();
}

// Red de seguridad: si por lo que sea el navegador bloqueó el redirect
// automático, dejamos un aviso con un link que el usuario puede tocar a
// mano para abrir WhatsApp.
function showWhatsAppFallback(url) {
  const existing = document.getElementById("wa-fallback");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.id = "wa-fallback";
  el.className = "wa-fallback";
  el.innerHTML = `¿No se abrió WhatsApp? <a href="${url}" target="_blank" rel="noopener">Toca aquí</a>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 8000);
}

loadItems();

// Refresca cada 30s por si alguien más reserva mientras estás mirando el catálogo
setInterval(loadItems, 30000);
