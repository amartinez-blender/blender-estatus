// app.js — Punto de entrada: configuración, auth, router y orquestación de vistas.

import { initFirebase } from "./firebase.js";
import { store, on, emit, $, $$, escapeHtml, debounce } from "./utils.js";
import { initAuth, login, logout } from "./auth.js";
import { ROLES, roleLabel } from "./roles.js";
import { can } from "./permissions.js";
import { listenUsers, renderUsersAdmin, updateMyProfile } from "./users.js";
import { listenColumns, renderColumnsAdmin } from "./columns.js";
import { listenTickets } from "./tickets.js";
import { listenMyNotifications, renderNotificationsPanel, markAllRead } from "./notifications.js";
import { renderBoard, openTicketModal, openTicketForm } from "./board.js";
import { renderDashboard } from "./dashboard.js";
import { initVendorFilter } from "./filters.js";
import { ensureSeed, createDemoData, resetAllData } from "./seed.js";
import { listenSettings, getSla, saveSlaSettings, getPermissionOverrides, savePermissionOverrides } from "./settings.js";
import { ASSIGNABLE_ROLES } from "./roles.js";
import { toast, openModal, closeModal, bindModalDismiss, avatarHtml } from "./ui.js";

let currentView = "board";
let appStarted = false;
let lastRole = null;
let slaTimer = null;

// Matriz de permisos para el resumen editable del Admin (req. 7).
// Capacidades mostradas y qué roles las tienen por defecto.
const PERM_CAPS = [
  ["ticket:create", "Crear tickets"],
  ["ticket:edit", "Editar tickets"],
  ["ticket:move", "Mover tarjetas"],
  ["ticket:cancel", "Cancelar / Cerrar"],
  ["comment:create", "Comentar"],
  ["attachment:add", "Adjuntar archivos"],
  ["ticket:setShippingCost", "Cotizar envío (costo)"],
  ["ticket:decideCost", "Aceptar / Retroalimentar costo"],
  ["ticket:markPaid", "Confirmar pago del cliente"],
  ["ticket:confirmPayment", "Confirmar pago (Admin)"],
  ["ticket:setPedido", "Agregar # de pedido"],
  ["ticket:setProductionPromise", "Fecha/Hora en Almacén"],
  ["ticket:setWarehousePromise", "Fecha/Hora para Listo"],
  ["dashboard:view", "Ver Dashboard"],
  ["admin:view", "Ver Admin"],
];
const PERM_DEFAULTS = {
  sales_admin: ["ticket:create", "ticket:edit", "ticket:move", "ticket:cancel", "comment:create", "attachment:add", "ticket:decideCost", "ticket:markPaid", "ticket:confirmPayment", "ticket:setPedido", "dashboard:view", "admin:view"],
  sales_exec: ["ticket:create", "ticket:edit", "ticket:cancel", "comment:create", "attachment:add", "ticket:decideCost", "ticket:markPaid", "ticket:setPedido", "dashboard:view"],
  production: ["ticket:move", "comment:create", "attachment:add", "ticket:setProductionPromise", "dashboard:view"],
  warehouse: ["ticket:move", "comment:create", "attachment:add", "ticket:setShippingCost", "ticket:setWarehousePromise", "dashboard:view"],
  administration: ["comment:create", "attachment:add", "ticket:confirmPayment", "dashboard:view"],
  auditor: ["dashboard:view"],
};

// ============================================================
// Arranque
// ============================================================

// ===================== Modo nocturno (req. 9) =====================
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $("#btn-theme");
  if (btn) {
    btn.textContent = theme === "dark" ? "☀️" : "🌙";
    btn.title = theme === "dark" ? "Modo claro" : "Modo nocturno";
  }
}
function initTheme() {
  let saved = "light";
  try { saved = localStorage.getItem("be-theme") || "light"; } catch {}
  applyTheme(saved);
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem("be-theme", next); } catch {}
  applyTheme(next);
}

async function boot() {
  initTheme();
  bindModalDismiss();
  bindStaticEvents();

  // config.js es local (copiado de config.example.js). Si falta, guiar al usuario.
  let config;
  try {
    config = await import("./config.js");
  } catch {
    showScreen("screen-setup");
    return;
  }

  store.config = { firebase: config.firebaseConfig, app: config.APP_CONFIG };
  document.title = config.APP_CONFIG.appName;
  initFirebase(config.firebaseConfig);

  initAuth({
    onSignedOut: () => {
      appStarted = false;
      lastRole = null;
      showScreen("screen-login");
    },
    onDomainRejected: (message) => {
      showScreen("screen-login");
      showLoginError(message);
    },
    onUserReady: (user) => handleUserReady(user),
    onError: (err) => {
      showScreen("screen-login");
      showLoginError("Error al iniciar sesión: " + (err.message || err));
    },
  });

  showScreen("screen-loading");
}

function handleUserReady(user) {
  if (user.active === false) {
    showScreen("screen-blocked");
    return;
  }
  if (user.role === ROLES.PENDING) {
    showScreen("screen-pending");
    return;
  }

  const roleChanged = lastRole !== null && lastRole !== user.role;
  lastRole = user.role;

  if (!appStarted || roleChanged) {
    appStarted = true;
    initVendorFilter(user); // preselecciona al propio vendedor (req. 7)
    startDataListeners();
    ensureSeed();
    startSlaTicker();
  }

  showScreen("app");
  renderHeader(user);
  renderNav(user);
  route(currentView, true);
}

function startDataListeners() {
  listenUsers();
  listenColumns();
  listenTickets(); // queries según rol (ver tickets.js)
  listenMyNotifications();
  listenSettings(); // SLA y configuración general
}

// Emite "sla:tick" cada 30 s para refrescar cuentas regresivas en vivo.
function startSlaTicker() {
  if (slaTimer) return;
  slaTimer = setInterval(() => emit("sla:tick"), 30000);
}

// ============================================================
// Pantallas y navegación
// ============================================================

const SCREENS = ["screen-loading", "screen-setup", "screen-login", "screen-blocked", "screen-pending", "app"];

function showScreen(id) {
  SCREENS.forEach((s) => $("#" + s)?.classList.toggle("hidden", s !== id));
}

function showLoginError(message) {
  const el = $("#login-error");
  el.textContent = message;
  el.classList.remove("hidden");
}

const VIEWS = {
  board: { el: "#view-board", render: renderBoard, allowed: () => true },
  dashboard: { el: "#view-dashboard", render: renderDashboard, allowed: (u) => can(u, "dashboard:view") },
  admin: { el: "#view-admin", render: renderAdmin, allowed: (u) => can(u, "admin:view") },
};

function renderNav(user) {
  $$("[data-view]").forEach((btn) => {
    const view = VIEWS[btn.dataset.view];
    if (view) btn.classList.toggle("hidden", !view.allowed(user));
  });
}

function route(viewName, force = false) {
  const user = store.currentUser;
  const view = VIEWS[viewName] && VIEWS[viewName].allowed(user) ? viewName : "board";
  if (view === currentView && !force) return;
  currentView = view;

  Object.entries(VIEWS).forEach(([name, v]) => {
    $(v.el).classList.toggle("hidden", name !== view);
  });
  $$("[data-view]").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.view === view)
  );
  VIEWS[view].render();
}

// ============================================================
// Header: notificaciones y menú de usuario
// ============================================================

function renderHeader(user) {
  $("#user-avatar").innerHTML = avatarHtml(user, 34);
  $("#menu-user-name").textContent = user.displayName;
  $("#menu-user-role").textContent = roleLabel(user.role);
  renderNotificationsPanel(openFromNotification);
}

function openFromNotification(ticketId) {
  $("#notif-panel").classList.add("hidden");
  route("board");
  openTicketModal(ticketId);
}

// ============================================================
// Panel Admin
// ============================================================

let adminTab = "users";

function renderAdmin() {
  const user = store.currentUser;
  const container = $("#admin-content");
  const isSuper = can(user, "settings:manage");

  const tabs = [
    { id: "users", label: "Usuarios", show: true },
    { id: "columns", label: "Columnas", show: true },
    { id: "settings", label: "Configuración", show: isSuper },
  ].filter((t) => t.show);

  if (!tabs.some((t) => t.id === adminTab)) adminTab = tabs[0].id;

  $("#admin-tabs").innerHTML = tabs.map((t) =>
    `<button class="tab ${adminTab === t.id ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`
  ).join("");

  $$("#admin-tabs [data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      adminTab = btn.dataset.tab;
      renderAdmin();
    });
  });

  if (adminTab === "users") renderUsersAdmin(container);
  else if (adminTab === "columns") renderColumnsAdmin(container);
  else renderSettingsAdmin(container);
}

// Construye la matriz de permisos por rol (resumen + toggles).
function permMatrixHtml() {
  const ov = getPermissionOverrides();
  const capLabel = Object.fromEntries(PERM_CAPS);
  const roles = ASSIGNABLE_ROLES.filter((r) => r !== ROLES.SUPERADMIN && r !== ROLES.PENDING);
  return roles.map((role) => {
    const caps = PERM_DEFAULTS[role] || [];
    return `
      <div class="perm-role">
        <strong>${escapeHtml(roleLabel(role))}</strong>
        <div class="perm-caps">
          ${caps.length ? caps.map((cap) => {
            const on = !(ov[role] && ov[role][cap] === false);
            return `<label class="chip-check">
              <input type="checkbox" class="perm-check" data-role="${role}" data-cap="${cap}" ${on ? "checked" : ""}>
              <span>${escapeHtml(capLabel[cap] || cap)}</span>
            </label>`;
          }).join("") : `<span class="text-muted">Solo lectura</span>`}
        </div>
      </div>`;
  }).join("");
}

function renderSettingsAdmin(container) {
  const cfg = store.config.app;
  const sla = getSla();
  container.innerHTML = `
    <div class="dash-card">
      <h4>Tiempos de SLA (cuenta regresiva)</h4>
      <p class="text-muted">Tiempo que tiene cada rol para asignar la fecha y hora antes de marcar la tarjeta como atrasada.</p>
      <div class="sla-form">
        <div class="sla-row">
          <span class="sla-row-label">Cotización → asignar "Costo de envío"</span>
          <div class="sla-inputs">
            <label>Horas <input type="number" min="0" class="input input-sm" id="sla-quote-h" value="${sla.quote.hours}"></label>
            <label>Minutos <input type="number" min="0" max="59" class="input input-sm" id="sla-quote-m" value="${sla.quote.minutes}"></label>
          </div>
        </div>
        <div class="sla-row">
          <span class="sla-row-label">Administración → marcar "Pago Confirmado"</span>
          <div class="sla-inputs">
            <label>Horas <input type="number" min="0" class="input input-sm" id="sla-admin-h" value="${sla.admin.hours}"></label>
            <label>Minutos <input type="number" min="0" max="59" class="input input-sm" id="sla-admin-m" value="${sla.admin.minutes}"></label>
          </div>
        </div>
        <div class="sla-row">
          <span class="sla-row-label">Producción → asignar "Fecha y Hora en Almacén"</span>
          <div class="sla-inputs">
            <label>Horas <input type="number" min="0" class="input input-sm" id="sla-prod-h" value="${sla.production.hours}"></label>
            <label>Minutos <input type="number" min="0" max="59" class="input input-sm" id="sla-prod-m" value="${sla.production.minutes}"></label>
          </div>
        </div>
        <div class="sla-row">
          <span class="sla-row-label">Almacén → asignar "Fecha y Hora para Listo"</span>
          <div class="sla-inputs">
            <label>Horas <input type="number" min="0" class="input input-sm" id="sla-wh-h" value="${sla.warehouse.hours}"></label>
            <label>Minutos <input type="number" min="0" max="59" class="input input-sm" id="sla-wh-m" value="${sla.warehouse.minutes}"></label>
          </div>
        </div>
        <button class="btn btn-primary" id="btn-save-sla">Guardar tiempos</button>
      </div>
    </div>

    <div class="dash-card">
      <h4>Configuración general</h4>
      <p class="text-muted">Estos valores se definen en <code>src/config.js</code> y se reflejan en <code>firebase.rules</code>.</p>
      <ul class="settings-list">
        <li><strong>Nombre:</strong> ${escapeHtml(cfg.appName)}</li>
        <li><strong>Dominios permitidos:</strong> ${(cfg.allowedDomains || [cfg.allowedDomain]).map((d) => "@" + escapeHtml(d)).join(", ")}</li>
        <li><strong>SuperAdmins:</strong> ${cfg.superAdminEmails.map(escapeHtml).join(", ")}</li>
        <li><strong>Rol por defecto:</strong> ${escapeHtml(roleLabel(cfg.defaultRole))}</li>
        <li><strong>Modo demo:</strong> ${cfg.demoMode ? "Activado" : "Desactivado"}</li>
      </ul>
      ${cfg.demoMode ? `<button class="btn btn-ghost" id="btn-demo-data">Generar datos demo</button>` : ""}
    </div>

    <div class="dash-card">
      <h4>Permisos por rol</h4>
      <p class="text-muted">Resumen de lo que puede hacer cada rol. Puedes apagar capacidades (no se pueden encender más allá de lo permitido por el rol; las reglas del servidor son la verdad).</p>
      <div class="perm-matrix">
        ${permMatrixHtml()}
      </div>
      <button class="btn btn-primary" id="btn-save-perms">Guardar permisos</button>
    </div>

    <div class="dash-card danger-card">
      <h4>Zona de peligro</h4>
      <p class="text-muted">Borra todos los tickets, números de pedido, histórico de atrasos y notificaciones. Conserva usuarios, columnas y configuración. No se puede deshacer.</p>
      <button class="btn btn-danger" id="btn-reset-all">Reestablecer todos los datos</button>
    </div>`;

  $("#btn-save-perms")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      const overrides = {};
      $$("#admin-content .perm-check").forEach((cb) => {
        if (!cb.checked) {
          const { role, cap } = cb.dataset;
          (overrides[role] = overrides[role] || {})[cap] = false;
        }
      });
      await savePermissionOverrides(overrides);
      toast("Permisos guardados.", "success");
    } catch (err) {
      toast("No se pudieron guardar: " + err.message, "error");
    } finally {
      e.target.disabled = false;
    }
  });

  $("#btn-reset-all")?.addEventListener("click", async (e) => {
    const ok = await confirmDialog({
      title: "Reestablecer TODOS los datos",
      message: "Se eliminarán todos los tickets, números de pedido, atrasos y notificaciones. Usuarios, columnas y configuración se conservan. Esta acción es irreversible.",
      confirmText: "Continuar", danger: true,
    });
    if (!ok) return;
    const typed = prompt('Escribe RESET (en mayúsculas) para confirmar el borrado total:');
    if (typed !== "RESET") {
      toast("Reinicio cancelado.", "info");
      return;
    }
    e.target.disabled = true;
    try {
      const r = await resetAllData();
      toast(`Datos reiniciados: ${r.tickets} tickets, ${r.breaches} atrasos, ${r.notifications} notificaciones.`, "success");
    } catch (err) {
      toast("No se pudo reiniciar: " + err.message, "error");
    } finally {
      e.target.disabled = false;
    }
  });

  $("#btn-save-sla")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await saveSlaSettings({
        quote: { hours: $("#sla-quote-h").value, minutes: $("#sla-quote-m").value },
        admin: { hours: $("#sla-admin-h").value, minutes: $("#sla-admin-m").value },
        production: { hours: $("#sla-prod-h").value, minutes: $("#sla-prod-m").value },
        warehouse: { hours: $("#sla-wh-h").value, minutes: $("#sla-wh-m").value },
      });
      toast("Tiempos de SLA guardados.", "success");
    } catch (err) {
      toast("No se pudo guardar: " + err.message, "error");
    } finally {
      e.target.disabled = false;
    }
  });

  $("#btn-demo-data")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      const n = await createDemoData();
      toast(`${n} tickets demo creados.`, "success");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      e.target.disabled = false;
    }
  });
}

// ============================================================
// Perfil
// ============================================================

function openProfile() {
  const user = store.currentUser;
  $("#profile-content").innerHTML = `
    <header class="modal-header">
      <h2>Mi perfil</h2>
      <button class="btn btn-icon" data-close aria-label="Cerrar">✕</button>
    </header>
    <div class="modal-body">
      <div class="profile-head">
        ${avatarHtml(user, 56)}
        <div>
          <strong>${escapeHtml(user.displayName)}</strong><br>
          <span class="text-muted">${escapeHtml(user.email)}</span><br>
          <span class="badge badge-role">${roleLabel(user.role)}</span>
        </div>
      </div>
      <label class="field">
        <span>Teléfono</span>
        <input class="input" id="profile-phone" type="tel" maxlength="20"
          value="${escapeHtml(user.phone || "")}" placeholder="55 0000 0000">
      </label>
      <footer class="modal-footer">
        <button class="btn btn-ghost" data-close>Cerrar</button>
        <button class="btn btn-primary" id="btn-save-profile">Guardar</button>
      </footer>
    </div>`;

  $("#btn-save-profile").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await updateMyProfile({ phone: $("#profile-phone").value });
      toast("Perfil actualizado.", "success");
      closeModal("profile-modal");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      e.target.disabled = false;
    }
  });

  openModal("profile-modal");
}

// ============================================================
// Eventos estáticos y reactividad
// ============================================================

function bindStaticEvents() {
  // Login / logout
  $("#btn-login").addEventListener("click", async () => {
    $("#login-error").classList.add("hidden");
    try {
      await login();
    } catch (err) {
      if (err.code !== "auth/popup-closed-by-user") {
        showLoginError("No se pudo iniciar sesión. Intenta de nuevo.");
      }
    }
  });
  ["#btn-logout", "#btn-logout-blocked", "#btn-logout-pending"].forEach((sel) => {
    $(sel)?.addEventListener("click", () => logout());
  });

  // Navegación (barra superior y barra inferior móvil)
  $$("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => route(btn.dataset.view));
  });

  // Modo nocturno
  $("#btn-theme")?.addEventListener("click", toggleTheme);

  // Nuevo ticket
  $("#btn-new-ticket").addEventListener("click", () => openTicketForm());

  // Filtros del tablero (estado, estatus de tarea SLA y búsqueda por número)
  $("#board-status-filter").addEventListener("change", renderBoard);
  $("#board-sla-filter").addEventListener("change", renderBoard);
  $("#board-search")?.addEventListener("input", debounce(renderBoard, 200));

  // Notificaciones
  $("#btn-notifications").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#notif-panel").classList.toggle("hidden");
  });
  $("#btn-mark-all").addEventListener("click", () => markAllRead().catch(() => {}));
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#notif-wrap")) $("#notif-panel").classList.add("hidden");
    if (!e.target.closest("#user-wrap")) $("#user-menu").classList.add("hidden");
  });

  // Menú de usuario
  $("#user-menu-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#user-menu").classList.toggle("hidden");
  });
  $("#btn-profile").addEventListener("click", () => {
    $("#user-menu").classList.add("hidden");
    openProfile();
  });

  // Reactividad: re-render de la vista activa cuando cambian los datos.
  on("tickets:changed", () => {
    if (!appStarted) return;
    if (currentView === "board") renderBoard();
    if (currentView === "dashboard") renderDashboard();
    if (currentView === "admin" && adminTab === "columns") renderAdmin();
  });
  on("columns:changed", () => {
    if (!appStarted) return;
    if (currentView === "board") renderBoard();
    if (currentView === "admin") renderAdmin();
  });
  on("users:changed", () => {
    if (!appStarted) return;
    if (currentView === "admin" && adminTab === "users") renderAdmin();
    // El tablero muestra avatares y el filtro de vendedores depende de los usuarios.
    if (currentView === "board") renderBoard();
  });
  on("notifications:changed", () => {
    if (!appStarted) return;
    renderNotificationsPanel(openFromNotification);
  });
  on("settings:changed", () => {
    if (!appStarted) return;
    // Los SLA cambian las cuentas regresivas del tablero.
    if (currentView === "board") renderBoard();
  });
}

boot();
