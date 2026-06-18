// filters.js — Filtro de vendedor compartido (multi-selección con checkboxes).
// Se usa en Tablero y Dashboard. El estado vive en store.vendorFilter:
//   []          => todos los vendedores
//   [uid, ...]  => solo esos vendedores

import { store, $, $$, escapeHtml } from "./utils.js";
import { ROLES } from "./roles.js";
import { sellableUsers } from "./users.js";
import { avatarHtml } from "./ui.js";

// Preselección inicial según rol: un Ejecutivo de Ventas ve solo lo suyo.
export function initVendorFilter(user) {
  if (user?.role === ROLES.SALES_EXEC) store.vendorFilter = [user.uid];
  else store.vendorFilter = [];
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

// Renderiza el control dentro de `host`. `onChange` se llama tras cada cambio
// (para refrescar solo los datos de la vista, sin reconstruir el control).
// Si el control ya existe en `host`, solo actualiza la etiqueta (mantiene el
// panel abierto durante una selección múltiple y sobrevive a re-renders).
export function renderVendorFilter(host, onChange) {
  if (!host) return;

  const sellers = sellableUsers();
  const sel = store.vendorFilter || [];
  // Firma de la lista de vendedores: si no cambió, no reconstruimos (así el panel
  // no se cierra en cada refresco). Si cambió (p. ej. al cargar usuarios), sí.
  const sig = sellers.map((u) => u.uid || u.id).join(",");
  if (host.dataset.sig === sig && host.dataset.ready === "1") {
    const lbl = $(".vfilter-label", host);
    if (lbl) lbl.textContent = currentLabel();
    return;
  }
  host.dataset.sig = sig;

  host.innerHTML = `
    <div class="vfilter">
      <button type="button" class="btn btn-ghost vfilter-btn" aria-haspopup="true" aria-expanded="false">
        <span>👤</span> <span class="vfilter-label">${escapeHtml(currentLabel())}</span> <span class="vfilter-caret">▾</span>
      </button>
      <div class="vfilter-panel hidden" role="menu">
        <label class="vfilter-opt vfilter-all">
          <input type="checkbox" class="vfilter-all-check" ${sel.length ? "" : "checked"}>
          <strong>Todos</strong>
        </label>
        <div class="vfilter-list">
          ${sellers.map((u) => {
            const id = u.uid || u.id;
            return `<label class="vfilter-opt">
              <input type="checkbox" class="vfilter-check" value="${id}" ${sel.includes(id) ? "checked" : ""}>
              ${avatarHtml(u, 20)} <span>${escapeHtml(u.displayName)}</span>
            </label>`;
          }).join("")}
        </div>
      </div>
    </div>`;
  host.dataset.ready = "1";

  const btn = $(".vfilter-btn", host);
  const panel = $(".vfilter-panel", host);
  const allCheck = $(".vfilter-all-check", host);
  const label = $(".vfilter-label", host);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = panel.classList.toggle("hidden") === false;
    btn.setAttribute("aria-expanded", String(open));
  });
  // Cerrar al hacer clic fuera.
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".vfilter")) panel.classList.add("hidden");
  });

  const apply = () => {
    label.textContent = currentLabel();
    onChange?.();
  };

  allCheck.addEventListener("change", () => {
    if (allCheck.checked) {
      $$(".vfilter-check", host).forEach((c) => (c.checked = false));
      store.vendorFilter = [];
    }
    apply();
  });

  $$(".vfilter-check", host).forEach((cb) => {
    cb.addEventListener("change", () => {
      const ids = $$(".vfilter-check", host).filter((c) => c.checked).map((c) => c.value);
      store.vendorFilter = ids;
      allCheck.checked = ids.length === 0;
      apply();
    });
  });
}
