// columns.js — Datos de columnas + sección "Columnas" del panel Admin.

import {
  fb, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, writeBatch, serverTimestamp,
} from "./firebase.js";
import { store, emit, escapeHtml, $, normalize,
  QUOTE_SHIPPING_TYPES, ROUTING_COLUMN_NAMES } from "./utils.js";
import { can } from "./permissions.js";
import { toast, confirmDialog } from "./ui.js";

// ===================== Datos =====================

export function listenColumns() {
  store.unsubs.columns?.();
  store.unsubs.columns = onSnapshot(
    collection(fb.db, "columns"),
    (snap) => {
      store.columns = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      emit("columns:changed", store.columns);
    },
    (err) => console.error("[columns] listener:", err)
  );
}

export function activeColumns() {
  return store.columns.filter((c) => c.active !== false);
}

export function getColumn(id) {
  return store.columns.find((c) => c.id === id) || null;
}

export function columnName(id) {
  return getColumn(id)?.name || "—";
}

// Busca una columna activa por nombre (tolerante a acentos/mayúsculas).
export function findColumnByName(name) {
  const target = normalize(name);
  return activeColumns().find((c) => normalize(c.name) === target) || null;
}

// Routing automático al CREAR un ticket:
//  - Recolección → columna "Administración" (todos pasan por Administración).
//  - Envío por cobrar / pre-pagado → columna "Cotización de envío".
// (Tras cotizar y confirmar el pago, Administración los manda a Fab/Almacén.)
export function routeColumnId(treatment, shippingType, fallbackId = null) {
  let targetName = null;
  if (normalize(shippingType) === normalize("Recolección")) {
    targetName = ROUTING_COLUMN_NAMES.ADMINISTRACION;
  } else if (QUOTE_SHIPPING_TYPES.map(normalize).includes(normalize(shippingType))) {
    targetName = ROUTING_COLUMN_NAMES.COTIZACION;
  }
  const col = targetName ? findColumnByName(targetName) : null;
  return col?.id || fallbackId || activeColumns()[0]?.id || null;
}

export async function createColumn(name) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("El nombre de la columna es obligatorio.");
  const maxOrder = Math.max(0, ...store.columns.map((c) => c.order ?? 0));
  await addDoc(collection(fb.db, "columns"), {
    name: clean,
    order: maxOrder + 1,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function renameColumn(id, name) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("El nombre no puede estar vacío.");
  await updateDoc(doc(fb.db, "columns", id), { name: clean, updatedAt: serverTimestamp() });
}

// Mueve la columna una posición (dir = -1 | +1) intercambiando `order`.
export async function moveColumn(id, dir) {
  const sorted = [...store.columns].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const idx = sorted.findIndex((c) => c.id === id);
  const swapWith = sorted[idx + dir];
  if (idx < 0 || !swapWith) return;
  const batch = writeBatch(fb.db);
  batch.update(doc(fb.db, "columns", id), { order: swapWith.order, updatedAt: serverTimestamp() });
  batch.update(doc(fb.db, "columns", swapWith.id), { order: sorted[idx].order, updatedAt: serverTimestamp() });
  await batch.commit();
}

export async function setColumnActive(id, active) {
  await updateDoc(doc(fb.db, "columns", id), { active: !!active, updatedAt: serverTimestamp() });
}

export async function deleteColumn(id) {
  const hasActiveTickets = store.tickets.some(
    (t) => t.columnId === id && t.status === "Activo"
  );
  if (hasActiveTickets) {
    throw new Error("No se puede eliminar: la columna tiene tickets activos.");
  }
  await deleteDoc(doc(fb.db, "columns", id));
}

// ===================== Render: Admin > Columnas =====================

export function renderColumnsAdmin(container) {
  const canManage = can(store.currentUser, "columns:manage");

  container.innerHTML = `
    ${canManage ? `
      <form id="form-new-column" class="admin-inline-form">
        <input class="input" id="new-column-name" placeholder="Nombre de la nueva columna" maxlength="40" required>
        <button class="btn btn-primary" type="submit">Crear columna</button>
      </form>` : `<p class="text-muted">Solo el SuperAdmin puede administrar columnas.</p>`}
    <div class="admin-list">
      ${store.columns.map((c, i) => `
        <div class="admin-column-row ${c.active === false ? "is-inactive" : ""}" data-id="${c.id}">
          <span class="column-order">${i + 1}</span>
          <strong class="column-row-name">${escapeHtml(c.name)}</strong>
          <span class="text-muted">${store.tickets.filter((t) => t.columnId === c.id && t.status === "Activo").length} tickets activos</span>
          ${canManage ? `
            <div class="admin-column-actions">
              <button class="btn btn-icon col-up" title="Subir" aria-label="Subir columna" ${i === 0 ? "disabled" : ""}>↑</button>
              <button class="btn btn-icon col-down" title="Bajar" aria-label="Bajar columna" ${i === store.columns.length - 1 ? "disabled" : ""}>↓</button>
              <button class="btn btn-ghost col-rename">Renombrar</button>
              <button class="btn btn-ghost col-toggle">${c.active === false ? "Activar" : "Desactivar"}</button>
              <button class="btn btn-ghost btn-danger-text col-delete">Eliminar</button>
            </div>` : ""}
        </div>`).join("")}
    </div>`;

  if (!canManage) return;

  $("#form-new-column", container)?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await createColumn($("#new-column-name", container).value);
      toast("Columna creada.", "success");
      e.target.reset();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  container.querySelectorAll(".admin-column-row").forEach((row) => {
    const id = row.dataset.id;
    const col = getColumn(id);

    row.querySelector(".col-up")?.addEventListener("click", () => moveColumn(id, -1).catch((e) => toast(e.message, "error")));
    row.querySelector(".col-down")?.addEventListener("click", () => moveColumn(id, 1).catch((e) => toast(e.message, "error")));

    row.querySelector(".col-rename")?.addEventListener("click", async () => {
      const name = prompt("Nuevo nombre de la columna:", col?.name || "");
      if (name === null) return;
      try {
        await renameColumn(id, name);
        toast("Columna renombrada.", "success");
      } catch (err) {
        toast(err.message, "error");
      }
    });

    row.querySelector(".col-toggle")?.addEventListener("click", async () => {
      try {
        await setColumnActive(id, col?.active === false);
        toast("Columna actualizada.", "success");
      } catch (err) {
        toast(err.message, "error");
      }
    });

    row.querySelector(".col-delete")?.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Eliminar columna",
        message: `¿Eliminar la columna "${col?.name}"? Esta acción no se puede deshacer.`,
        confirmText: "Eliminar",
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteColumn(id);
        toast("Columna eliminada.", "success");
      } catch (err) {
        toast(err.message, "error");
      }
    });
  });
}
