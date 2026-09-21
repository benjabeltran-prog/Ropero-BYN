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
    if (tab.dataset.tab === "items") loadItems();
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
}

// ---------- Revisar y publicar (borrador) ------------------------------

function openReview(item) {
  reviewRoot.innerHTML = `
    <div class="detail-overlay" id="review-overlay">
      <div class="detail-sheet">
        <button class="detail-close" id="review-close" aria-label="Cerrar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"></line><line x1="19" y1="5" x2="5" y2="19"></line></svg></button>
        <div class="gallery">
          <img src="${item.photo_enhanced}" alt="foto mejorada" />
          <img src="${item.photo_original}" alt="foto original" />
        </div>
        <div class="detail-body">
          <div class="status-banner">Revisa el resultado antes de publicarlo en el catálogo.</div>
          <div class="field">
            <label>Título</label>
            <input id="review-title" type="text" value="${escapeAttr(item.title)}" />
          </div>
          <div class="field">
            <label>Precio (CLP)</label>
            <input id="review-price" type="number" value="${item.price}" />
          </div>
          <div class="field">
            <label>Descripción</label>
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

    const { error } = await supabase
      .from("items")
      .update({ title, price, description, status: "disponible" })
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
        <div class="gallery">
          ${[item.photo_enhanced, item.photo_original].filter(Boolean).map((src) => `<img src="${src}" alt="foto" />`).join("")}
        </div>
        <div class="detail-body">
          <div class="status-banner">Editando "${escapeAttr(item.title)}"</div>
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
            <label for="edit-description">Descripción</label>
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

  document.getElementById("edit-close").addEventListener("click", closeReview);
  document.getElementById("edit-cancel-btn").addEventListener("click", closeReview);
  document.getElementById("edit-overlay").addEventListener("click", (e) => {
    if (e.target.id === "edit-overlay") closeReview();
  });

  document.getElementById("edit-save-btn").addEventListener("click", async (e) => {
    const title = document.getElementById("edit-title").value.trim();
    const price = Number(document.getElementById("edit-price").value);
    const category = document.getElementById("edit-category").value;
    const size = document.getElementById("edit-size").value.trim();
    const condition = document.getElementById("edit-condition").value;
    const description = document.getElementById("edit-description").value.trim();

    if (!title || !price) {
      alert("Completa al menos el título y el precio.");
      return;
    }

    e.target.disabled = true;
    e.target.textContent = "Guardando…";

    const { error } = await supabase
      .from("items")
      .update({ title, price, category, size, condition, description })
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
  const photo = item.photo_enhanced || item.photo_original || "";
  return `
    <div class="item-row" id="row-${item.id}">
      <img src="${photo}" alt="" />
      <div class="info">
        <div class="name">${item.title}</div>
        <div class="sub">${money(item.price)} · ${statusLabel(item.status)}</div>
      </div>
      <div class="actions">
        ${item.status === "borrador" ? `<button class="btn btn-secondary btn-small" data-action="review">Revisar</button>` : ""}
        ${item.status !== "borrador" ? `<button class="btn btn-secondary btn-small" data-action="editar">Editar</button>` : ""}
        ${item.status === "reservada" ? `<button class="btn btn-secondary btn-small" data-action="vendida">Vendida</button>` : ""}
        ${item.status === "reservada" ? `<button class="btn btn-secondary btn-small" data-action="liberar">Liberar</button>` : ""}
        ${item.status === "disponible" ? `<button class="btn btn-secondary btn-small" data-action="vendida">Vendida</button>` : ""}
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
    await supabase.from("items").update({ status: "vendida" }).eq("id", item.id);
  }
  if (action === "liberar") {
    await supabase.from("items").update({ status: "disponible", reserved_at: null }).eq("id", item.id);
  }
  if (action === "eliminar") {
    if (!confirm(`¿Eliminar "${item.title}"? Esta acción no se puede deshacer.`)) return;
    await supabase.from("items").delete().eq("id", item.id);
  }
  loadItems();
}

// ---------- Init -----------------------------------------------------------

checkSession();
