// dashboard.js — Métricas y actividad reciente, con filtros en cliente.

import { store, $, escapeHtml, toDate, relativeTime, daysSince,
  TREATMENTS, SHIPPING_TYPES, DELIVERY_MODES } from "./utils.js";
import { visibleTickets } from "./permissions.js";
import { activeColumns, columnName } from "./columns.js";
import { userName, sellableUsers } from "./users.js";
import { fetchRecentActivity } from "./activity.js";
import { emptyState, loadingState } from "./ui.js";

const filters = {
  dateFrom: "", dateTo: "", owner: "", columnId: "", treatment: "", shippingType: "",
};

export function renderDashboard() {
  const container = $("#dashboard-content");
  container.innerHTML = `
    <div class="dash-filters">
      <label class="field"><span>Desde</span>
        <input type="date" class="input" id="df-from" value="${filters.dateFrom}"></label>
      <label class="field"><span>Hasta</span>
        <input type="date" class="input" id="df-to" value="${filters.dateTo}"></label>
      <label class="field"><span>Vendedor</span>
        <select class="input" id="df-owner">
          <option value="">Todos</option>
          ${sellableUsers().map((u) => `<option value="${u.uid || u.id}" ${filters.owner === (u.uid || u.id) ? "selected" : ""}>${escapeHtml(u.displayName)}</option>`).join("")}
        </select></label>
      <label class="field"><span>Columna</span>
        <select class="input" id="df-column">
          <option value="">Todas</option>
          ${activeColumns().map((c) => `<option value="${c.id}" ${filters.columnId === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
        </select></label>
      <label class="field"><span>Tratamiento</span>
        <select class="input" id="df-treatment">
          <option value="">Todos</option>
          ${TREATMENTS.map((t) => `<option ${filters.treatment === t ? "selected" : ""}>${t}</option>`).join("")}
        </select></label>
      <label class="field"><span>Tipo de envío</span>
        <select class="input" id="df-shipping">
          <option value="">Todos</option>
          ${SHIPPING_TYPES.map((t) => `<option ${filters.shippingType === t ? "selected" : ""}>${t}</option>`).join("")}
        </select></label>
    </div>
    <div id="dash-metrics"></div>
    <section class="detail-section">
      <h3>Actividad reciente</h3>
      <div id="dash-activity">${loadingState()}</div>
    </section>`;

  const bind = (id, key) => {
    $(id).addEventListener("change", (e) => {
      filters[key] = e.target.value;
      renderMetrics();
    });
  };
  bind("#df-from", "dateFrom");
  bind("#df-to", "dateTo");
  bind("#df-owner", "owner");
  bind("#df-column", "columnId");
  bind("#df-treatment", "treatment");
  bind("#df-shipping", "shippingType");

  renderMetrics();
  renderRecentActivity();
}

function applyFilters(tickets) {
  return tickets.filter((t) => {
    const created = toDate(t.createdAt);
    if (filters.dateFrom && created && created < new Date(filters.dateFrom + "T00:00:00")) return false;
    if (filters.dateTo && created && created > new Date(filters.dateTo + "T23:59:59")) return false;
    if (filters.owner && t.ownerId !== filters.owner) return false;
    if (filters.columnId && t.columnId !== filters.columnId) return false;
    if (filters.treatment && t.treatment !== filters.treatment) return false;
    if (filters.shippingType && t.shippingType !== filters.shippingType) return false;
    return true;
  });
}

function countBy(tickets, keyFn) {
  const map = new Map();
  tickets.forEach((t) => {
    const k = keyFn(t) || "—";
    map.set(k, (map.get(k) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function barChart(title, entries, total) {
  if (!entries.length) return `<div class="dash-card"><h4>${title}</h4><p class="text-muted">Sin datos.</p></div>`;
  return `
    <div class="dash-card">
      <h4>${title}</h4>
      ${entries.map(([label, n]) => `
        <div class="bar-row">
          <span class="bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${total ? Math.round((n / total) * 100) : 0}%"></div></div>
          <span class="bar-value">${n}</span>
        </div>`).join("")}
    </div>`;
}

function renderMetrics() {
  const box = $("#dash-metrics");
  if (!box) return;
  const user = store.currentUser;
  const staleDays = store.config.app.staleDays || 5;
  const tickets = applyFilters(visibleTickets(user, store.tickets));

  if (!store.tickets.length) {
    box.innerHTML = emptyState("Aún no hay tickets. Las métricas aparecerán aquí.", "📊");
    return;
  }

  const active = tickets.filter((t) => t.status === "Activo");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const createdToday = tickets.filter((t) => toDate(t.createdAt) >= today).length;
  const recentlyUpdated = tickets.filter((t) => daysSince(t.updatedAt) <= 1).length;
  const stale = active.filter((t) => daysSince(t.lastMovedAt) >= staleDays);

  box.innerHTML = `
    <div class="dash-kpis">
      <div class="kpi-card"><strong>${tickets.length}</strong><span>Tickets (filtro)</span></div>
      <div class="kpi-card"><strong>${active.length}</strong><span>Activos</span></div>
      <div class="kpi-card"><strong>${createdToday}</strong><span>Creados hoy</span></div>
      <div class="kpi-card"><strong>${recentlyUpdated}</strong><span>Actualizados (24 h)</span></div>
      <div class="kpi-card ${stale.length ? "kpi-warn" : ""}"><strong>${stale.length}</strong><span>Sin movimiento +${staleDays} d</span></div>
    </div>
    <div class="dash-grid">
      ${barChart("Por columna", countBy(active, (t) => columnName(t.columnId)), active.length)}
      ${barChart("Por tratamiento", countBy(tickets, (t) => t.treatment), tickets.length)}
      ${barChart("Por tipo de envío", countBy(tickets, (t) => t.shippingType), tickets.length)}
      ${barChart("Por modalidad de entrega", countBy(tickets, (t) => t.deliveryMode), tickets.length)}
      ${barChart("Por vendedor", countBy(tickets, (t) => userName(t.ownerId)), tickets.length)}
      ${barChart("Por estado", countBy(tickets, (t) => t.status), tickets.length)}
    </div>
    ${stale.length ? `
      <div class="dash-card dash-stale">
        <h4>Tickets sin movimiento por más de ${staleDays} días</h4>
        <ul class="activity-list">
          ${stale.slice(0, 10).map((t) => `
            <li><span>#${escapeHtml(t.orderNumber)} · ${escapeHtml(columnName(t.columnId))} · ${escapeHtml(userName(t.ownerId))}</span>
            <time>${relativeTime(t.lastMovedAt)}</time></li>`).join("")}
        </ul>
      </div>` : ""}`;
}

async function renderRecentActivity() {
  const box = $("#dash-activity");
  if (!box) return;
  try {
    const items = await fetchRecentActivity(25);
    if (!items.length) {
      box.innerHTML = `<p class="text-muted">Sin actividad reciente.</p>`;
      return;
    }
    box.innerHTML = `<ul class="activity-list">${items.map((a) => `
      <li><span>${escapeHtml(a.message)}</span><time>${relativeTime(a.createdAt)}</time></li>`).join("")}</ul>`;
  } catch (err) {
    // Suele faltar el índice collection-group la primera vez (ver README).
    console.error("[dashboard] actividad reciente:", err);
    box.innerHTML = `<p class="text-muted">No se pudo cargar la actividad reciente.
      Si es la primera vez, crea el índice que sugiere la consola de Firebase (ver README).</p>`;
  }
}
