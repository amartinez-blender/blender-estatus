// filters.js — Filtro de vendedor compartido (multi-selección con checkboxes).
// Se usa en Tablero y Dashboard. El estado vive en store.vendorFilter:
//   []          => todos los vendedores
//   [uid, ...]  => solo esos vendedores

import { store, $, $$, escapeHtml } from "./utils.js";
import { ROLES } from "./roles.js";
import { sellableUsers } from "./users.js";
import { avatarHtml } from "./ui.js";

// Por defecto el filtro muestra TODOS los vendedores (req. 6: todos ven todas
// las tarjetas). Cada usuario puede luego filtrar por uno o varios vendedores.
export function initVendorFilter() {
  store.vendorFilter = [];
}

// ¿El ticket pasa el filtro de vendedor activo?
export function vendorFilterMatch(ticket) {
  const sel = store.vendorFilter || [];
  if (!sel.length) return true; // todos
  return sel.includes(ticket.ownerId);
}

function currentLabel() {
  const sel = store.vendorFilter || [];
  if (!sel.length) return "Todos los vendedores";
  if (sel.length === 1) {
    const u = sellableUsers().find((x) => (x.uid || x.id) === sel[0]);
    return u?.displayName || "1 vendedor";
  }
  return `${sel.length} vendedores`;
}

// Renderiza el control dentro de `host`. La LISTA de vendedores se construye
// cada vez que se ABRE el panel (lee los usuarios en ese momento), así no
// depende de cuándo se cargaron. `onChange` se llama tras cada cambio.
export function renderVendorFilter(host, onChange) {
  if (!host) return;

  // Construir el contenedor (botón + panel vacío) una sola vez.
  if (host.dataset.ready !== "1") {
    host.innerHTML = `
      <div class="vfilter">
        <button type="button" class="btn btn-ghost vfilter-btn" aria-haspopup="true" aria-expanded="false">
          <span>👤</span> <span class="vfilter-label">${escapeHtml(currentLabel())}</span> <span class="vfilter-caret">▾</span>
        </button>
        <div class="vfilter-panel hidden" role="menu"></div>
      </div>`;
    host.dataset.ready = "1";

    const btn = $(".vfilter-btn", host);
    const panel = $(".vfilter-panel", host);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willShow = panel.classList.contains("hidden");
      if (willShow) buildVendorPanel(host, panel, onChange); // lista fresca al abrir
      panel.classList.toggle("hidden");
      btn.setAttribute("aria-expanded", String(willShow));
    });
    document.addEventListener("click", (e) => {
      if (!host.contains(e.target)) panel.classList.add("hidden");
    });
  }

  const lbl = $(".vfilter-label", host);
  if (lbl) lbl.textContent = currentLabel();
}

// Llena el panel con los vendedores actuales y enlaza los eventos.
function buildVendorPanel(host, panel, onChange) {
  const sellers = sellableUsers();
  const sel = store.vendorFilter || [];

  panel.innerHTML = `
    <label class="vfilter-opt vfilter-all">
      <input type="checkbox" class="vfilter-all-check" ${sel.length ? "" : "checked"}>
      <strong>Todos</strong>
    </label>
    <div class="vfilter-list">
      ${sellers.length
        ? sellers.map((u) => {
            const id = u.uid || u.id;
            return `<label class="vfilter-opt">
              <input type="checkbox" class="vfilter-check" value="${id}" ${sel.includes(id) ? "checked" : ""}>
              ${avatarHtml(u, 20)} <span>${escapeHtml(u.displayName)}</span>
            </label>`;
          }).join("")
        : `<p class="text-muted vfilter-empty">No hay vendedores activos.</p>`}
    </div>`;

  const allCheck = $(".vfilter-all-check", panel);
  const label = $(".vfilter-label", host);
  const apply = () => {
    if (label) label.textContent = currentLabel();
    onChange?.();
  };

  allCheck.addEventListener("change", () => {
    if (allCheck.checked) {
      $$(".vfilter-check", panel).forEach((c) => (c.checked = false));
      store.vendorFilter = [];
    }
    apply();
  });

  $$(".vfilter-check", panel).forEach((cb) => {
    cb.addEventListener("change", () => {
      const ids = $$(".vfilter-check", panel).filter((c) => c.checked).map((c) => c.value);
      store.vendorFilter = ids;
      allCheck.checked = ids.length === 0;
      apply();
    });
  });
}
