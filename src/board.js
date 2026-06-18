// board.js — Vista Kanban: columnas, tarjetas, drag & drop,
// modal de creación y panel de detalle del ticket.

import { store, $, $$, on, escapeHtml, relativeTime, fmtDateTime, fmtFileSize, fmtCountdown, fmtMoney, normalize,
  mainOrderNumber, orderRef,
  TREATMENTS, SHIPPING_TYPES, DELIVERY_MODES, PRIORITIES, PAYMENT_TYPES, MAX_ADDRESS_LENGTH } from "./utils.js";
import { can, visibleTickets } from "./permissions.js";
import { activeColumns, getColumn, columnName, routeColumnId } from "./columns.js";
import { renderVendorFilter, vendorFilterMatch } from "./filters.js";
import { computeSla, isFabricacionColumn, isAlmacenColumn, isCotizacionColumn, isCotizacionListaColumn, isAdministracionColumn } from "./sla.js";
import { getTicket, createTicket, updateTicket, moveTicket, setTicketStatus, deleteTicket,
  setProductionPromise, setWarehousePromise, setShippingCost,
  acceptShippingCost, markShippingPaid, rejectShippingCost, confirmPayment } from "./tickets.js";
import { getUser, userName, sellableUsers } from "./users.js";
import { listenComments, addComment, editComment, softDeleteComment, mentionSuggestions, highlightMentions } from "./comments.js";
import { listenAttachments, uploadAttachment, deleteAttachment, isImage } from "./attachments.js";
import { listenTicketActivity } from "./activity.js";
import { toast, confirmDialog, openModal, closeModal, avatarHtml, priorityBadge, statusBadge, emptyState, setSaving } from "./ui.js";

// Adjunta el nombre de la columna al ticket para los checks de permiso
// sensibles a la columna (mover, según rol — reqs. 5 y 6).
const withCol = (t) => ({ ...t, _columnName: columnName(t.columnId) });

// ============================================================
// Tablero
// ============================================================

export function renderBoard() {
  const user = store.currentUser;
  $("#btn-new-ticket").classList.toggle("hidden", !can(user, "ticket:create"));

  // Filtro de vendedor (se renderiza una vez en su host estático del toolbar).
  renderVendorFilter($("#board-vendor-filter"), renderBoardColumns);

  renderBoardColumns();
}

// Renderiza solo las columnas/tarjetas (sin reconstruir el toolbar/filtro).
function renderBoardColumns() {
  const user = store.currentUser;
  const container = $("#board");
  const cols = activeColumns();

  if (!cols.length) {
    container.innerHTML = emptyState("Aún no hay columnas configuradas. El SuperAdmin puede crearlas en el panel Admin.", "🗂️");
    return;
  }

  const filter = $("#board-status-filter").value || "Activo";
  const slaFilter = $("#board-sla-filter")?.value || ""; // "", "ontime", "late"
  const tickets = visibleTickets(user, store.tickets)
    .filter((t) => (filter === "Todos" ? true : t.status === filter))
    .filter(vendorFilterMatch)
    .filter((t) => {
      if (!slaFilter) return true;
      const sla = computeSla(t);
      if (!sla) return false; // sin SLA no entra en "en tiempo"/"atrasada"
      return slaFilter === "late" ? sla.late : !sla.late;
    });

  container.innerHTML = cols.map((col) => {
    const colTickets = tickets.filter((t) => t.columnId === col.id);
    return `
      <section class="board-column" data-col="${col.id}">
        <header class="column-header">
          <h3>${escapeHtml(col.name)}</h3>
          <span class="column-count">${colTickets.length}</span>
        </header>
        <div class="column-body" data-col="${col.id}">
          ${colTickets.length
            ? colTickets.map((t) => cardHtml(t, user)).join("")
            : `<div class="column-empty">Sin tickets</div>`}
        </div>
        ${can(user, "ticket:create") ? `
          <button class="btn btn-add-card" data-col="${col.id}">+ Agregar ticket</button>` : ""}
      </section>`;
  }).join("");

  bindBoardEvents(container, user);
}

function cardHtml(t, user) {
  const owner = getUser(t.ownerId);
  const movable = can(user, "ticket:move", withCol(t)) && t.status === "Activo";
  const sla = computeSla(t);
  return `
    <article class="card ${t.status !== "Activo" ? "card-" + t.status.toLowerCase() : ""} ${sla?.late ? "card-late" : ""}"
      data-id="${t.id}" draggable="${movable}">
      <div class="card-top">
        <strong class="card-order">${escapeHtml(orderRef(t))}</strong>
        ${t.pedidoNumber ? `<span class="tag tag-cot" title="Número de cotización">Cot. #${escapeHtml(t.orderNumber)}</span>` : ""}
        ${priorityBadge(t.priority)}
        ${t.status !== "Activo" ? statusBadge(t.status) : ""}
      </div>
      <div class="card-tags">
        <span class="tag">${escapeHtml(t.treatment)}</span>
        <span class="tag">${escapeHtml(t.shippingType)}</span>
        <span class="tag">${escapeHtml(t.deliveryMode)}</span>
      </div>
      ${sla ? `
        <div class="card-sla ${sla.late ? "sla-late" : "sla-ontime"}">
          <span class="sla-dot">${sla.late ? "🔴" : "🟢"}</span>
          <span class="sla-label">${escapeHtml(sla.label)}</span>
          <span class="sla-count">${sla.late ? "Vencido" : fmtCountdown(sla.remainingMs)}</span>
        </div>` : ""}
      ${isCotizacionListaColumn(t) && t.status === "Activo" && t.costDecision !== "accepted" ? `
        <div class="card-sla sla-await">⏳ Por aceptar costo de envío</div>` : ""}
      ${isCotizacionListaColumn(t) && t.status === "Activo" && t.costDecision === "accepted"
        && normalize(t.shippingType) === normalize("Envío pre-pagado") && !t.shippingPaidByClient ? `
        <div class="card-sla sla-await">⏳ Falta confirmar pago del cliente</div>` : ""}
      ${isAdministracionColumn(t) && t.status === "Activo" && !t.paymentConfirmed ? `
        <div class="card-sla sla-await">🧾 Por confirmar pago</div>` : ""}
      <div class="card-footer">
        ${avatarHtml(owner, 24)}
        <span class="card-meta">
          ${t.shippingCost != null ? `<span class="card-cost" title="Costo de envío">${escapeHtml(fmtMoney(t.shippingCost))}</span>` : ""}
          ${t.commentsCount ? `<span title="Comentarios">💬 ${t.commentsCount}</span>` : ""}
          ${t.attachmentsCount ? `<span title="Adjuntos">📎 ${t.attachmentsCount}</span>` : ""}
        </span>
        <time class="card-time" title="Última actualización">${relativeTime(t.updatedAt)}</time>
      </div>
    </article>`;
}

function bindBoardEvents(container, user) {
  // Abrir detalle
  $$(".card", container).forEach((card) => {
    card.addEventListener("click", () => openTicketModal(card.dataset.id));
  });

  // Crear en columna específica
  $$(".btn-add-card", container).forEach((btn) => {
    btn.addEventListener("click", () => openTicketForm(btn.dataset.col));
  });

  // Drag & drop nativo (desktop). En móvil se usa "Mover a…" en el detalle.
  $$(".card[draggable='true']", container).forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", card.dataset.id);
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
  });

  $$(".column-body", container).forEach((zone) => {
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", async (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      const ticket = getTicket(e.dataTransfer.getData("text/plain"));
      if (!ticket || !can(user, "ticket:move", withCol(ticket))) return;
      try {
        await moveTicket(ticket, zone.dataset.col);
      } catch (err) {
        toast("No se pudo mover el ticket: " + err.message, "error");
      }
    });
  });
}

// ============================================================
// Formulario de creación
// ============================================================

export function openTicketForm(defaultColumnId = null) {
  const user = store.currentUser;
  if (!can(user, "ticket:create")) return;
  const sellers = sellableUsers();
  // El creador aparece por defecto como responsable, pero puede elegir a otro
  // vendedor (req. 4). El selector se muestra siempre que existan vendedores.
  const defaultOwner = sellers.some((u) => (u.uid || u.id) === user.uid) ? user.uid : (sellers[0]?.uid || user.uid);

  $("#form-modal-content").innerHTML = `
    <header class="modal-header">
      <h2>Nuevo ticket</h2>
      <button class="btn btn-icon" data-close aria-label="Cerrar">✕</button>
    </header>
    <form id="ticket-form" class="modal-body" novalidate>
      <div class="form-errors hidden" id="tf-errors"></div>
      <div class="form-grid">
        <label class="field">
          <span>Número de cotización *</span>
          <input class="input" id="tf-order" inputmode="numeric" pattern="\\d{1,5}"
            maxlength="5" placeholder="12345" required>
        </label>
        <label class="field">
          <span>Tratamiento *</span>
          <select class="input" id="tf-treatment" required>
            <option value="">Selecciona…</option>
            ${TREATMENTS.map((t) => `<option>${t}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Tipo de envío *</span>
          <select class="input" id="tf-shipping" required>
            <option value="">Selecciona…</option>
            ${SHIPPING_TYPES.map((t) => `<option>${t}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Modalidad de entrega *</span>
          <select class="input" id="tf-delivery" required>
            <option value="">Selecciona…</option>
            ${DELIVERY_MODES.map((t) => `<option>${t}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Tipo de pago *</span>
          <select class="input" id="tf-payment" required>
            <option value="">Selecciona…</option>
            ${PAYMENT_TYPES.map((p) => `<option>${p}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Prioridad</span>
          <select class="input" id="tf-priority">
            <option value="">Sin prioridad</option>
            ${PRIORITIES.map((p) => `<option>${p}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Vendedor responsable</span>
          <select class="input" id="tf-owner">
            ${sellers.map((u) => `<option value="${u.uid || u.id}" ${(u.uid || u.id) === defaultOwner ? "selected" : ""}>${escapeHtml(u.displayName)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="field auto-column-note" id="tf-column-note">
        <span>Columna asignada automáticamente</span>
        <div class="auto-column-pill" id="tf-column-pill">Selecciona tratamiento y tipo de envío…</div>
      </div>
      <label class="field field-checkbox">
        <input type="checkbox" id="tf-address-na">
        <span>Dirección N/A</span>
      </label>
      <label class="field" id="tf-address-field">
        <span>Dirección de envío *</span>
        <textarea class="input" id="tf-address" rows="3" maxlength="${MAX_ADDRESS_LENGTH}"
          placeholder="Calle, número, colonia, ciudad, CP…"></textarea>
      </label>
      <footer class="modal-footer">
        <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary" id="tf-submit">Crear ticket</button>
      </footer>
    </form>`;

  const naCheck = $("#tf-address-na");
  const treatmentSel = $("#tf-treatment");
  const shippingSel = $("#tf-shipping");
  const deliverySel = $("#tf-delivery");

  const setAddressDisabled = (disabled) => {
    naCheck.checked = disabled;
    $("#tf-address").disabled = disabled;
    $("#tf-address-field").classList.toggle("is-disabled", disabled);
  };

  naCheck.addEventListener("change", () => setAddressDisabled(naCheck.checked));

  // Vista previa de la columna destino según las reglas de routing.
  const updateColumnPill = () => {
    const pill = $("#tf-column-pill");
    const targetId = routeColumnId(treatmentSel.value, shippingSel.value, defaultColumnId);
    pill.textContent = targetId
      ? `→ ${columnName(targetId)}`
      : "Selecciona tratamiento y tipo de envío…";
  };

  treatmentSel.addEventListener("change", updateColumnPill);

  // Req. 5: al elegir "Recolección" → marca N/A y fija Modalidad = Recolección.
  shippingSel.addEventListener("change", () => {
    if (normalize(shippingSel.value) === normalize("Recolección")) {
      setAddressDisabled(true);
      deliverySel.value = "Recolección";
    }
    updateColumnPill();
  });

  $("#ticket-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#tf-submit");
    const errBox = $("#tf-errors");
    errBox.classList.add("hidden");
    setSaving(btn, true);
    try {
      const treatment = treatmentSel.value;
      const shippingType = shippingSel.value;
      // Routing automático (reqs. 1, 2, 3): la columna se decide por las reglas.
      const columnId = routeColumnId(treatment, shippingType, defaultColumnId);
      await createTicket({
        orderNumber: $("#tf-order").value.trim(),
        treatment,
        shippingType,
        deliveryMode: deliverySel.value,
        priority: $("#tf-priority").value || null,
        tipoPago: $("#tf-payment").value,
        columnId,
        ownerId: $("#tf-owner").value,
        addressNA: naCheck.checked,
        shippingAddress: $("#tf-address").value,
      });
      toast("Ticket creado.", "success");
      closeModal("form-modal");
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove("hidden");
    } finally {
      setSaving(btn, false, "Crear ticket");
    }
  });

  openModal("form-modal");
}

// ============================================================
// Detalle del ticket (panel lateral)
// ============================================================

const detail = { ticketId: null, unsubs: [] };

function closeDetailListeners() {
  detail.unsubs.forEach((u) => u?.());
  detail.unsubs = [];
  detail.ticketId = null;
}

export function openTicketModal(ticketId) {
  const ticket = getTicket(ticketId);
  if (!ticket) {
    toast("No tienes acceso a ese ticket o ya no existe.", "error");
    return;
  }
  closeDetailListeners();
  detail.ticketId = ticketId;
  renderTicketDetail(ticket);
  openModal("ticket-modal");

  $("#ticket-modal").addEventListener("modal:close", closeDetailListeners, { once: true });

  detail.unsubs.push(listenComments(ticketId, (items) => renderComments(ticket, items)));
  detail.unsubs.push(listenAttachments(ticketId, (items) => renderAttachments(ticket, items)));
  detail.unsubs.push(listenTicketActivity(ticketId, renderActivity));
}

// Sección de decisión del costo en "Cotización de envío lista" (Aceptar/Rechazar).
function costDecisionSectionHtml(t, user) {
  if (t.status !== "Activo" || !isCotizacionListaColumn(t)) return "";
  const prepaid = normalize(t.shippingType) === normalize("Envío pre-pagado");
  const canDecide = can(user, "ticket:decideCost", t);
  const canPay = can(user, "ticket:markPaid", t);
  const costTxt = t.shippingCost != null ? fmtMoney(t.shippingCost) : "—";

  let body;
  if (t.costDecision !== "accepted") {
    // Pendiente de aceptar/rechazar (solo el vendedor creador).
    body = canDecide
      ? `<label class="field">
           <span># de pedido * <small class="text-muted">(requerido al aceptar)</small></span>
           <input class="input" id="tm-pedido" inputmode="numeric" maxlength="10" placeholder="Ej. 100245">
         </label>
         <div class="detail-actions">
           <button class="btn btn-primary" id="tm-cost-accept">Aceptar costo</button>
           <button class="btn btn-ghost btn-danger-text" id="tm-cost-reject">Rechazar costo</button>
         </div>`
      : `<p class="text-muted">Esperando que ${escapeHtml(userName(t.createdBy))} (vendedor que creó el ticket) acepte o rechace el costo.</p>`;
  } else if (prepaid && !t.shippingPaidByClient) {
    // Aceptado y pre-pagado: falta confirmar el pago del cliente.
    body = canPay
      ? `<label class="field field-checkbox">
           <input type="checkbox" id="tm-paid-check">
           <span>Envío Pagado por el cliente</span>
         </label>
         <button class="btn btn-primary" id="tm-paid-save">Confirmar y continuar</button>`
      : `<p class="text-muted">Costo aceptado. Falta que el vendedor asignado o el Administrador de Ventas marquen "Envío Pagado por el cliente".</p>`;
  } else {
    body = `<p class="text-muted">Costo aceptado.</p>`;
  }

  return `
    <div class="sla-box cost-decision-box">
      <div class="sla-banner">
        <span>💲</span>
        <strong class="sla-label">Costo de envío: ${escapeHtml(costTxt)}</strong>
        <span class="sla-count">${escapeHtml(t.shippingType)}</span>
      </div>
      ${body}
    </div>`;
}

// Sección de Administración: estatus "Confirmar Pago" + casilla Pago Confirmado.
function adminSectionHtml(t, user) {
  if (t.status !== "Activo" || !isAdministracionColumn(t)) return "";
  const sla = computeSla(t);
  const canConfirm = can(user, "ticket:confirmPayment", withCol(t));
  return `
    <div class="sla-box ${sla?.late ? "sla-late" : "sla-ontime"}" id="tm-sla-box">
      <div class="sla-banner">
        <span class="sla-dot">${sla?.late ? "🔴" : "🟢"}</span>
        <strong class="sla-label">${escapeHtml(sla?.label || "")}</strong>
        <span class="sla-count">${sla ? (sla.late ? "Vencido" : "Restan " + fmtCountdown(sla.remainingMs)) : ""}</span>
      </div>
      <label class="field field-checkbox">
        <input type="checkbox" id="tm-payment-confirmed" ${t.paymentConfirmed ? "checked" : ""} ${canConfirm ? "" : "disabled"}>
        <span>Pago Confirmado</span>
      </label>
      ${canConfirm
        ? `<button class="btn btn-primary" id="tm-confirm-payment">Confirmar pago y continuar</button>`
        : `<p class="text-muted">Solo el rol de Administración puede confirmar el pago.</p>`}
    </div>`;
}

// Sección SLA del detalle: banner de estatus + campo de fecha/hora por rol.
function slaSectionHtml(t, user) {
  if (t.status !== "Activo") return "";
  const cot = isCotizacionColumn(t);
  const fab = isFabricacionColumn(t);
  const alm = isAlmacenColumn(t);
  if (!cot && !fab && !alm) return "";

  const sla = computeSla(t);
  const banner = `
    <div class="sla-banner">
      <span class="sla-dot">${sla?.late ? "🔴" : "🟢"}</span>
      <strong class="sla-label">${escapeHtml(sla?.label || "")}</strong>
      <span class="sla-count">${sla ? (sla.late ? "Vencido" : "Restan " + fmtCountdown(sla.remainingMs)) : ""}</span>
    </div>`;

  // Columna Cotización de envío → campo Costo de envío (req. 2, 4, 6).
  if (cot) {
    const canSet = can(user, "ticket:setShippingCost", t);
    const current = t.shippingCost != null ? t.shippingCost : "";
    return `
      <div class="sla-box ${sla?.late ? "sla-late" : "sla-ontime"}" id="tm-sla-box">
        ${banner}
        <label class="field">
          <span>Costo de envío (MXN)${canSet ? " *" : ""}</span>
          <input type="number" min="0" step="0.01" inputmode="decimal" class="input"
            id="tm-cost" placeholder="0.00" value="${escapeHtml(String(current))}" ${canSet ? "" : "disabled"}>
        </label>
        ${t.shippingCost != null ? `<p class="text-muted">Actual: <strong>${escapeHtml(fmtMoney(t.shippingCost))}</strong></p>` : ""}
        ${canSet
          ? `<button class="btn btn-primary" id="tm-cost-save">Guardar costo y marcar lista</button>`
          : `<p class="text-muted">Solo el rol de Almacén puede cotizar el envío.</p>`}
      </div>`;
  }

  // Columnas Fabricación / Almacén → campo de fecha y hora.
  const fieldLabel = fab ? "Fecha y Hora en Almacén" : "Fecha y Hora para Listo";
  const value = fab ? (t.promiseDateWarehouse || "") : (t.promiseDateReady || "");
  const canSet = fab
    ? can(user, "ticket:setProductionPromise", t)
    : can(user, "ticket:setWarehousePromise", t);

  return `
    <div class="sla-box ${sla?.late ? "sla-late" : "sla-ontime"}" id="tm-sla-box">
      ${banner}
      <label class="field">
        <span>${fieldLabel}${canSet ? " *" : ""}</span>
        <input type="datetime-local" class="input" id="tm-promise" value="${escapeHtml(value)}" ${canSet ? "" : "disabled"}>
      </label>
      ${canSet
        ? `<button class="btn btn-primary" id="tm-promise-save">Guardar fecha y hora</button>`
        : `<p class="text-muted">Solo ${fab ? "Producción" : "Almacén"} puede asignar este dato.</p>`}
    </div>`;
}

// Refresca el banner SLA del detalle abierto (lo llama el ticker en vivo).
function refreshDetailSla() {
  const box = $("#tm-sla-box");
  if (!box || !detail.ticketId) return;
  const t = getTicket(detail.ticketId);
  if (!t) return;
  const sla = computeSla(t);
  if (!sla) return;
  box.classList.toggle("sla-late", sla.late);
  box.classList.toggle("sla-ontime", !sla.late);
  const dot = box.querySelector(".sla-dot");
  const label = box.querySelector(".sla-label");
  const count = box.querySelector(".sla-count");
  if (dot) dot.textContent = sla.late ? "🔴" : "🟢";
  if (label) label.textContent = sla.label;
  if (count) count.textContent = sla.late ? "Vencido" : "Restan " + fmtCountdown(sla.remainingMs);
}

function renderTicketDetail(t) {
  const user = store.currentUser;
  const canEdit = can(user, "ticket:edit", t) && t.status === "Activo";
  const canCancel = can(user, "ticket:cancel", t) && t.status === "Activo";
  const canClose = can(user, "ticket:close", t) && t.status === "Activo";
  const canMove = can(user, "ticket:move", withCol(t)) && t.status === "Activo";
  const canComment = can(user, "comment:create", t) && t.status === "Activo";
  const canAttach = can(user, "attachment:add", t) && t.status === "Activo";
  const canAssign = can(user, "ticket:assignOwner", t);
  const canPayType = can(user, "ticket:setPaymentType", t) && t.status === "Activo";
  const isSuper = can(user, "ticket:delete", t);
  const dis = canEdit ? "" : "disabled";
  const cols = activeColumns();

  $("#ticket-modal-content").innerHTML = `
    <header class="modal-header">
      <div>
        <h2>${escapeHtml(orderRef(t))}</h2>
        <div class="detail-sub">
          ${t.pedidoNumber ? `<span class="badge badge-muted"># Cotización: ${escapeHtml(t.orderNumber)}</span>` : ""}
          ${statusBadge(t.status)}
          <span class="badge badge-column">${escapeHtml(columnName(t.columnId))}</span>
          ${priorityBadge(t.priority)}
        </div>
      </div>
      <button class="btn btn-icon" data-close aria-label="Cerrar">✕</button>
    </header>

    <div class="modal-body detail-body">
      <div class="form-errors hidden" id="tm-errors"></div>

      ${canMove ? `
        <label class="field field-move">
          <span>Mover a</span>
          <select class="input" id="tm-move">
            ${cols.map((c) => `<option value="${c.id}" ${c.id === t.columnId ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
          </select>
        </label>` : ""}

      ${slaSectionHtml(t, user)}
      ${costDecisionSectionHtml(t, user)}
      ${adminSectionHtml(t, user)}

      <div class="form-grid">
        <label class="field">
          <span>Tipo de pago${canPayType ? " *" : ""}</span>
          <select class="input" id="tm-payment" ${canPayType ? "" : "disabled"}>
            ${PAYMENT_TYPES.map((x) => `<option ${t.tipoPago === x ? "selected" : ""}>${x}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Tratamiento</span>
          <select class="input" id="tm-treatment" ${dis}>
            ${TREATMENTS.map((x) => `<option ${t.treatment === x ? "selected" : ""}>${x}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Tipo de envío</span>
          <select class="input" id="tm-shipping" ${dis}>
            ${SHIPPING_TYPES.map((x) => `<option ${t.shippingType === x ? "selected" : ""}>${x}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Modalidad de entrega</span>
          <select class="input" id="tm-delivery" ${dis}>
            ${DELIVERY_MODES.map((x) => `<option ${t.deliveryMode === x ? "selected" : ""}>${x}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Prioridad</span>
          <select class="input" id="tm-priority" ${dis}>
            <option value="">Sin prioridad</option>
            ${PRIORITIES.map((x) => `<option ${t.priority === x ? "selected" : ""}>${x}</option>`).join("")}
          </select>
        </label>
        ${canAssign ? `
          <label class="field">
            <span>Vendedor responsable</span>
            <select class="input" id="tm-owner">
              ${sellableUsers().map((u) => `<option value="${u.uid || u.id}" ${(u.uid || u.id) === t.ownerId ? "selected" : ""}>${escapeHtml(u.displayName)}</option>`).join("")}
            </select>
          </label>` : ""}
      </div>

      <label class="field field-checkbox">
        <input type="checkbox" id="tm-address-na" ${t.addressNA ? "checked" : ""} ${dis}>
        <span>Dirección N/A</span>
      </label>
      <label class="field ${t.addressNA ? "is-disabled" : ""}" id="tm-address-field">
        <span>Dirección de envío</span>
        <textarea class="input" id="tm-address" rows="3" maxlength="${MAX_ADDRESS_LENGTH}"
          ${t.addressNA || !canEdit ? "disabled" : ""}>${escapeHtml(t.shippingAddress || "")}</textarea>
      </label>

      <div class="detail-meta text-muted">
        <span>Creado por <strong>${escapeHtml(userName(t.createdBy))}</strong> · ${fmtDateTime(t.createdAt)}</span>
        <span>Responsable: <strong>${escapeHtml(userName(t.ownerId))}</strong></span>
        <span>Última actualización: ${fmtDateTime(t.updatedAt)}</span>
      </div>

      ${canEdit || canClose || canCancel || isSuper || (t.status !== "Activo" && can(user, "ticket:edit", t)) ? `
        <div class="detail-actions">
          ${canEdit ? `<button class="btn btn-primary" id="tm-save">Guardar</button>` : ""}
          ${canClose ? `<button class="btn btn-ghost" id="tm-close-ticket">Cerrar ticket</button>` : ""}
          ${canCancel ? `<button class="btn btn-ghost btn-danger-text" id="tm-cancel-ticket">Cancelar ticket</button>` : ""}
          ${t.status !== "Activo" && can(user, "ticket:edit", t) ? `<button class="btn btn-ghost" id="tm-reopen">Reabrir</button>` : ""}
          ${isSuper ? `<button class="btn btn-danger" id="tm-delete">Eliminar</button>` : ""}
        </div>` : ""}

      <section class="detail-section">
        <h3>Comentarios</h3>
        <div id="tm-comments">${`<div class="loading-state"><span class="spinner"></span></div>`}</div>
        ${canComment ? `
          <div class="comment-composer">
            <div class="mention-box hidden" id="tm-mention-box"></div>
            <textarea class="input" id="tm-comment-input" rows="2"
              placeholder="Escribe un comentario… usa @ para mencionar"></textarea>
            <button class="btn btn-primary" id="tm-comment-send">Comentar</button>
          </div>` : `<p class="text-muted">No puedes comentar en este ticket.</p>`}
      </section>

      <section class="detail-section">
        <h3>Adjuntos</h3>
        <div id="tm-attachments">${`<div class="loading-state"><span class="spinner"></span></div>`}</div>
        ${canAttach ? `
          <div class="attach-controls">
            <label class="btn btn-ghost">
              📎 Subir archivo
              <input type="file" id="tm-file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden>
            </label>
            <label class="btn btn-ghost only-mobile">
              📷 Tomar foto
              <input type="file" id="tm-camera" accept="image/*" capture="environment" hidden>
            </label>
            <div class="upload-progress hidden" id="tm-upload-progress">
              <div class="upload-bar"><span id="tm-upload-fill"></span></div>
              <span id="tm-upload-pct">0%</span>
            </div>
          </div>` : ""}
      </section>

      <section class="detail-section">
        <h3>Historial de actividad</h3>
        <div id="tm-activity">${`<div class="loading-state"><span class="spinner"></span></div>`}</div>
      </section>
    </div>`;

  bindDetailEvents(t, { canEdit, canComment, canAttach, canAssign, canPayType, isSuper });
}

function bindDetailEvents(t, perms) {
  // Mover
  $("#tm-move")?.addEventListener("change", async (e) => {
    try {
      await moveTicket(t, e.target.value);
      toast("Ticket movido.", "success");
      closeModal("ticket-modal");
      closeDetailListeners();
    } catch (err) {
      toast("No se pudo mover: " + err.message, "error");
    }
  });

  // Guardar Fecha y Hora (Producción → en Almacén; Almacén → para Listo).
  $("#tm-promise-save")?.addEventListener("click", async () => {
    const value = $("#tm-promise").value;
    if (!value) {
      toast("Selecciona una fecha y hora.", "error");
      return;
    }
    const btn = $("#tm-promise-save");
    setSaving(btn, true);
    try {
      if (isFabricacionColumn(t)) await setProductionPromise(t, value);
      else await setWarehousePromise(t, value);
      toast("Fecha y hora guardada.", "success");
      closeModal("ticket-modal");
      closeDetailListeners();
    } catch (err) {
      toast("No se pudo guardar: " + err.message, "error");
    } finally {
      setSaving(btn, false, "Guardar fecha y hora");
    }
  });

  // Guardar Costo de envío (mueve la tarjeta a "Cotización de envío lista").
  $("#tm-cost-save")?.addEventListener("click", async () => {
    const raw = $("#tm-cost").value;
    if (raw === "" || Number(raw) < 0 || !isFinite(Number(raw))) {
      toast("Captura un costo de envío válido.", "error");
      return;
    }
    const btn = $("#tm-cost-save");
    setSaving(btn, true);
    try {
      await setShippingCost(t, Number(raw));
      toast("Costo guardado. Cotización lista.", "success");
      closeModal("ticket-modal");
      closeDetailListeners();
    } catch (err) {
      toast("No se pudo guardar: " + err.message, "error");
    } finally {
      setSaving(btn, false, "Guardar costo y marcar lista");
    }
  });

  // Aceptar / Rechazar costo (vendedor creador) en "Cotización de envío lista".
  $("#tm-cost-accept")?.addEventListener("click", async () => {
    const pedido = $("#tm-pedido")?.value.trim();
    if (!pedido || !/^\d{1,10}$/.test(pedido)) {
      toast("Captura el # de pedido (solo números) para aceptar el costo.", "error");
      return;
    }
    const btn = $("#tm-cost-accept");
    setSaving(btn, true);
    try {
      await acceptShippingCost(t, pedido);
      toast("Costo aceptado. # de pedido asignado.", "success");
      closeModal("ticket-modal");
      closeDetailListeners();
    } catch (err) {
      toast("No se pudo aceptar: " + err.message, "error");
      setSaving(btn, false, "Aceptar costo");
    }
  });
  $("#tm-cost-reject")?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Rechazar costo de envío",
      message: `El ticket #${mainOrderNumber(t)} regresará a Cotización de envío para recotizar. ¿Continuar?`,
      confirmText: "Rechazar", danger: true,
    });
    if (!ok) return;
    try {
      await rejectShippingCost(t);
      toast("Costo rechazado. Regresó a Cotización de envío.", "success");
      closeModal("ticket-modal");
      closeDetailListeners();
    } catch (err) {
      toast("No se pudo rechazar: " + err.message, "error");
    }
  });
  // Confirmar "Envío Pagado por el cliente" (pre-pagado).
  $("#tm-paid-save")?.addEventListener("click", async () => {
    if (!$("#tm-paid-check")?.checked) {
      toast("Marca la casilla 'Envío Pagado por el cliente' para continuar.", "error");
      return;
    }
    const btn = $("#tm-paid-save");
    setSaving(btn, true);
    try {
      await markShippingPaid(t);
      toast("Pago confirmado. Ticket en proceso.", "success");
      closeModal("ticket-modal");
      closeDetailListeners();
    } catch (err) {
      toast("No se pudo confirmar: " + err.message, "error");
      setSaving(btn, false, "Confirmar y continuar");
    }
  });

  // Confirmar Pago (Administración) → la tarjeta avanza a Fabricación/Almacén.
  $("#tm-confirm-payment")?.addEventListener("click", async () => {
    if (!$("#tm-payment-confirmed")?.checked) {
      toast("Marca la casilla 'Pago Confirmado' para continuar.", "error");
      return;
    }
    const btn = $("#tm-confirm-payment");
    setSaving(btn, true);
    try {
      await confirmPayment(t);
      toast("Pago confirmado. El pedido avanzó.", "success");
      closeModal("ticket-modal");
      closeDetailListeners();
    } catch (err) {
      toast("No se pudo confirmar: " + err.message, "error");
      setSaving(btn, false, "Confirmar pago y continuar");
    }
  });

  // N/A dirección
  $("#tm-address-na")?.addEventListener("change", (e) => {
    const ta = $("#tm-address");
    ta.disabled = e.target.checked || !perms.canEdit;
    $("#tm-address-field").classList.toggle("is-disabled", e.target.checked);
  });

  // Guardar
  $("#tm-save")?.addEventListener("click", async () => {
    const errBox = $("#tm-errors");
    errBox.classList.add("hidden");
    setSaving($("#tm-save"), true);
    try {
      const changes = {
        treatment: $("#tm-treatment").value,
        shippingType: $("#tm-shipping").value,
        deliveryMode: $("#tm-delivery").value,
        priority: $("#tm-priority").value || null,
        addressNA: $("#tm-address-na").checked,
        shippingAddress: $("#tm-address-na").checked ? "" : $("#tm-address").value,
      };
      if (perms.canAssign) changes.ownerId = $("#tm-owner").value;
      if (perms.canPayType) changes.tipoPago = $("#tm-payment").value;
      await updateTicket(t, changes);
      toast("Cambios guardados.", "success");
      closeModal("ticket-modal");
      closeDetailListeners();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove("hidden");
    } finally {
      setSaving($("#tm-save"), false, "Guardar");
    }
  });

  // Cerrar / cancelar / reabrir / eliminar
  const statusAction = (btnId, status, label, danger) => {
    $(btnId)?.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: `${label} ticket`,
        message: `¿${label} el ticket #${mainOrderNumber(t)}?`,
        confirmText: label,
        danger,
      });
      if (!ok) return;
      try {
        await setTicketStatus(t, status);
        toast(`Ticket ${status.toLowerCase()}.`, "success");
        closeModal("ticket-modal");
        closeDetailListeners();
      } catch (err) {
        toast("Error: " + err.message, "error");
      }
    });
  };
  statusAction("#tm-close-ticket", "Cerrado", "Cerrar", false);
  statusAction("#tm-cancel-ticket", "Cancelado", "Cancelar", true);
  statusAction("#tm-reopen", "Activo", "Reabrir", false);

  $("#tm-delete")?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Eliminar ticket",
      message: `¿Eliminar definitivamente el ticket #${mainOrderNumber(t)}? Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteTicket(t);
      toast("Ticket eliminado.", "success");
      closeModal("ticket-modal");
      closeDetailListeners();
    } catch (err) {
      toast("Error: " + err.message, "error");
    }
  });

  // Comentarios
  if (perms.canComment) {
    const input = $("#tm-comment-input");
    bindMentionAutocomplete(input);
    $("#tm-comment-send").addEventListener("click", async () => {
      try {
        await addComment(t, input.value);
        input.value = "";
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  // Adjuntos
  if (perms.canAttach) {
    const handleFile = async (file) => {
      if (!file) return;
      const progress = $("#tm-upload-progress");
      const fill = $("#tm-upload-fill");
      const pct = $("#tm-upload-pct");
      progress.classList.remove("hidden");
      try {
        await uploadAttachment(t, file, (p) => {
          fill.style.width = p + "%";
          pct.textContent = p + "%";
        });
        toast("Archivo subido.", "success");
      } catch (err) {
        toast(err.message, "error");
      } finally {
        progress.classList.add("hidden");
        fill.style.width = "0%";
      }
    };
    $("#tm-file").addEventListener("change", (e) => handleFile(e.target.files[0]));
    $("#tm-camera")?.addEventListener("change", (e) => handleFile(e.target.files[0]));
  }
}

// ---------- Autocompletado de menciones ----------
function bindMentionAutocomplete(textarea) {
  const box = $("#tm-mention-box");
  textarea.addEventListener("input", () => {
    const upToCaret = textarea.value.slice(0, textarea.selectionStart);
    const match = upToCaret.match(/@([^\n@]{0,25})$/);
    if (!match) {
      box.classList.add("hidden");
      return;
    }
    const suggestions = mentionSuggestions(match[1]);
    if (!suggestions.length) {
      box.classList.add("hidden");
      return;
    }
    box.innerHTML = suggestions.map((u) =>
      `<button class="mention-option" data-name="${escapeHtml(u.displayName)}">
        ${avatarHtml(u, 20)} ${escapeHtml(u.displayName)}
      </button>`).join("");
    box.classList.remove("hidden");
    box.querySelectorAll(".mention-option").forEach((opt) => {
      opt.addEventListener("click", () => {
        const start = upToCaret.lastIndexOf("@");
        textarea.value =
          textarea.value.slice(0, start) + "@" + opt.dataset.name + " " +
          textarea.value.slice(textarea.selectionStart);
        box.classList.add("hidden");
        textarea.focus();
      });
    });
  });
}

// ---------- Render de listas en vivo ----------

function renderComments(ticket, comments) {
  const box = $("#tm-comments");
  if (!box) return;
  const user = store.currentUser;
  const visible = comments.filter((c) => !c.deleted);

  if (!visible.length) {
    box.innerHTML = `<p class="text-muted">Sin comentarios aún.</p>`;
    return;
  }

  box.innerHTML = visible.map((c) => {
    const author = getUser(c.createdBy);
    const mine = can(user, "comment:edit", { ticket, comment: c });
    return `
      <div class="comment" data-id="${c.id}">
        ${avatarHtml(author, 28)}
        <div class="comment-content">
          <div class="comment-head">
            <strong>${escapeHtml(author?.displayName || "Usuario")}</strong>
            <time>${fmtDateTime(c.createdAt)}${c.updatedAt ? " · editado" : ""}</time>
          </div>
          <p>${highlightMentions(escapeHtml(c.text))}</p>
          ${mine ? `
            <div class="comment-actions">
              <button class="link-btn c-edit">Editar</button>
              <button class="link-btn c-delete">Eliminar</button>
            </div>` : ""}
        </div>
      </div>`;
  }).join("");

  box.querySelectorAll(".comment").forEach((el) => {
    const comment = visible.find((c) => c.id === el.dataset.id);
    el.querySelector(".c-edit")?.addEventListener("click", async () => {
      const text = prompt("Editar comentario:", comment.text);
      if (text === null) return;
      try {
        await editComment(ticket.id, comment.id, text);
      } catch (err) {
        toast(err.message, "error");
      }
    });
    el.querySelector(".c-delete")?.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: "Eliminar comentario",
        message: "¿Eliminar este comentario?",
        confirmText: "Eliminar",
        danger: true,
      });
      if (!ok) return;
      try {
        await softDeleteComment(ticket, comment);
      } catch (err) {
        toast(err.message, "error");
      }
    });
  });
}

function renderAttachments(ticket, attachments) {
  const box = $("#tm-attachments");
  if (!box) return;
  const user = store.currentUser;

  if (!attachments.length) {
    box.innerHTML = `<p class="text-muted">Sin adjuntos.</p>`;
    return;
  }

  box.innerHTML = `<div class="attach-grid">${attachments.map((a) => {
    const canDelete = can(user, "attachment:delete", { ticket, attachment: a });
    return `
      <div class="attach-item" data-id="${a.id}">
        <a href="${escapeHtml(a.downloadURL)}" target="_blank" rel="noopener" class="attach-preview">
          ${isImage(a)
            ? `<img src="${escapeHtml(a.downloadURL)}" alt="${escapeHtml(a.fileName)}" loading="lazy">`
            : `<span class="attach-pdf">📄<small>PDF</small></span>`}
        </a>
        <div class="attach-info">
          <span class="attach-name" title="${escapeHtml(a.fileName)}">${escapeHtml(a.fileName)}</span>
          <small class="text-muted">${fmtFileSize(a.fileSize || 0)} · ${escapeHtml(userName(a.uploadedBy))}</small>
        </div>
        ${canDelete ? `<button class="btn btn-icon a-delete" title="Eliminar adjunto" aria-label="Eliminar adjunto">🗑</button>` : ""}
      </div>`;
  }).join("")}</div>`;

  box.querySelectorAll(".a-delete").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.closest(".attach-item").dataset.id;
      const att = attachments.find((a) => a.id === id);
      const ok = await confirmDialog({
        title: "Eliminar adjunto",
        message: `¿Eliminar "${att.fileName}"?`,
        confirmText: "Eliminar",
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteAttachment(ticket, att);
      } catch (err) {
        toast(err.message, "error");
      }
    });
  });
}

function renderActivity(items) {
  const box = $("#tm-activity");
  if (!box) return;
  if (!items.length) {
    box.innerHTML = `<p class="text-muted">Sin actividad registrada.</p>`;
    return;
  }
  box.innerHTML = `<ul class="activity-list">${items.map((a) => `
    <li>
      <span>${escapeHtml(a.message)}</span>
      <time>${relativeTime(a.createdAt)}</time>
    </li>`).join("")}</ul>`;
}

// ============================================================
// Ticker en vivo del SLA (cuenta regresiva)
// ============================================================
// app.js emite "sla:tick" periódicamente. Refrescamos las tarjetas del
// tablero (si está visible) y el banner del detalle (si está abierto).
on("sla:tick", () => {
  if (!store.currentUser) return;
  const boardVisible = !$("#view-board")?.classList.contains("hidden");
  if (boardVisible) renderBoardColumns();
  if (detail.ticketId) refreshDetailSla();
});
