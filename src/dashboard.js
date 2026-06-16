// dashboard.js — Métricas y actividad reciente, con filtros en cliente.

import { store, $, $$, escapeHtml, toDate, relativeTime, daysSince, fmtCountdown,
  TREATMENTS, SHIPPING_TYPES, DELIVERY_MODES, TICKET_STATUSES } from "./utils.js";
import { visibleTickets } from "./permissions.js";
import { activeColumns, columnName } from "./columns.js";
import { userName } from "./users.js";
import { renderVendorFilter, vendorFilterMatch } from "./filters.js";
import { fetchSlaBreaches } from "./activity.js";
import { emptyState, loadingState } from "./ui.js";

const filters = {
  dateFrom: "", dateTo: "", columnId: "", treatment: "", shippingType: "", status: "",
};

// Estados de atraso (req. 4).
const BREACH_PHASES = [
  "Cotización de envío",
  "Asignar fecha (Producción)",
  "Cambiar a Almacén",
  "Asignar fecha (Almacén)",
  "Cambiar a Listos",
];
const phaseFilter = new Set(BREACH_PHASES); // todas seleccionadas por defecto

export function renderDashboard() {
  breachCache = null; // refresca atrasos al entrar al Dashboard
  const container = $("#dashboard-content");
  container.innerHTML = `
    <div class="dash-filters">
      <label class="field"><span>Vendedor</span>
        <div id="dash-vendor-filter" class="vfilter-host"></div></label>
      <label class="field"><span>Desde</span>
        <input type="date" class="input" id="df-from" value="${filters.dateFrom}"></label>
      <label class="field"><span>Hasta</span>
        <input type="date" class="input" id="df-to" value="${filters.dateTo}"></label>
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
      <label class="field"><span>Status</span>
        <select class="input" id="df-status">
          <option value="">Todos</option>
          ${TICKET_STATUSES.map((s) => `<option ${filters.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select></label>
    </div>
    <div id="dash-metrics"></div>

    <section class="detail-section">
      <h3>Atrasos (histórico)</h3>
      <p class="text-muted">Tarjetas que se atrasaron en algún momento, aunque su estatus actual sea otro.</p>
      <div class="breach-phase-filter" id="breach-phase-filter">
        ${BREACH_PHASES.map((p) => `
          <label class="chip-check">
            <input type="checkbox" class="breach-phase" value="${escapeHtml(p)}" ${phaseFilter.has(p) ? "checked" : ""}>
            <span>${escapeHtml(p)}</span>
          </label>`).join("")}
      </div>
      <div id="dash-breaches">${loadingState()}</div>
    </section>`;

  const bind = (id, key) => {
    $(id).addEventListener("change", (e) => {
      filters[key] = e.target.value;
      renderMetrics();
      renderBreaches();
    });
  };
  bind("#df-from", "dateFrom");
  bind("#df-to", "dateTo");
  bind("#df-column", "columnId");
  bind("#df-treatment", "treatment");
  bind("#df-shipping", "shippingType");
  bind("#df-status", "status");

  $$(".breach-phase").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      if (e.target.checked) phaseFilter.add(e.target.value);
      else phaseFilter.delete(e.target.value);
      renderBreaches();
    });
  });

  // Filtro de vendedor compartido (multi-selección). Refresca solo las métricas.
  renderVendorFilter($("#dash-vendor-filter"), () => { renderMetrics(); renderBreaches(); });

  renderMetrics();
  renderBreaches();
}

// Caché simple para no re-leer en cada cambio de filtro.
let breachCache = null;

async function renderBreaches() {
  const box = $("#dash-breaches");
  if (!box) return;
  try {
    if (!breachCache) breachCache = await fetchSlaBreaches();
    const from = filters.dateFrom ? new Date(filters.dateFrom + "T00:00:00") : null;
    const to = filters.dateTo ? new Date(filters.dateTo + "T23:59:59") : null;
    const sellers = store.vendorFilter || [];

    const rows = breachCache.filter((b) => {
      if (!phaseFilter.has(b.phase)) return false;
      const d = toDate(b.createdAt);
      if (from && d && d < from) return false;
      if (to && d && d > to) return false;
      if (sellers.length && b.ownerId && !sellers.includes(b.ownerId)) return false;
      return true;
    });

    if (!rows.length) {
      box.innerHTML = `<p class="text-muted">Sin atrasos registrados para el filtro actual.</p>`;
      return;
    }

    // Agregados por fase.
    const agg = {};
    let totalMs = 0;
    rows.forEach((b) => {
      const a = (agg[b.phase] = agg[b.phase] || { count: 0, ms: 0 });
      a.count += 1; a.ms += b.lateMs || 0; totalMs += b.lateMs || 0;
    });
    const phases = Object.entries(agg).sort((x, y) => y[1].count - x[1].count);
    const maxCount = Math.max(...phases.map(([, a]) => a.count));
    const avgMs = totalMs / rows.length;

    box.innerHTML = `
      <div class="dash-kpis">
        <div class="kpi-card"><strong>${rows.length}</strong><span>Atrasos totales</span></div>
        <div class="kpi-card"><strong>${fmtCountdown(totalMs)}</strong><span>Tiempo total atrasado</span></div>
        <div class="kpi-card"><strong>${fmtCountdown(avgMs)}</strong><span>Atraso promedio</span></div>
      </div>
      <div class="dash-card breach-bars">
        <h4>Atrasos por estado</h4>
        ${phases.map(([phase, a]) => `
          <div class="bar-row breach-row">
            <span class="bar-label" title="${escapeHtml(phase)}">${escapeHtml(phase)}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${maxCount ? Math.round((a.count / maxCount) * 100) : 0}%"></div></div>
            <span class="bar-value">${a.count}</span>
          </div>`).join("")}
      </div>
      <div class="dash-card breach-bars">
        <h4>Atraso promedio por estado</h4>
        ${phases.map(([phase, a]) => `
          <div class="bar-row breach-row">
            <span class="bar-label" title="${escapeHtml(phase)}">${escapeHtml(phase)}</span>
            <span class="bar-value bar-value-wide">prom. ${fmtCountdown(a.ms / a.count)} · total ${fmtCountdown(a.ms)}</span>
          </div>`).join("")}
      </div>`;
  } catch (err) {
    console.error("[dashboard] atrasos:", err);
    box.innerHTML = `<p class="text-muted">No se pudieron cargar los atrasos. Si es la primera vez, crea el índice que sugiera la consola de Firebase.</p>`;
  }
}

function applyFilters(tickets) {
  return tickets.filter((t) => {
    const created = toDate(t.createdAt);
    if (filters.dateFrom && created && created < new Date(filters.dateFrom + "T00:00:00")) return false;
    if (filters.dateTo && created && created > new Date(filters.dateTo + "T23:59:59")) return false;
    if (!vendorFilterMatch(t)) return false;
    if (filters.status && t.status !== filters.status) return false;
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
