// app.js — Punto de entrada: configuración, auth, router y orquestación de vistas.

import { initFirebase } from "./firebase.js";
import { store, on, $, $$, escapeHtml } from "./utils.js";
import { initAuth, login, logout } from "./auth.js";
import { ROLES, roleLabel } from "./roles.js";
import { can } from "./permissions.js";
import { listenUsers, renderUsersAdmin, updateMyProfile } from "./users.js";
import { listenColumns, renderColumnsAdmin } from "./columns.js";
import { listenTickets } from "./tickets.js";
import { listenMyNotifications, renderNotificationsPanel, markAllRead } from "./notifications.js";
import { renderBoard, openTicketModal, openTicketForm } from "./board.js";
import { renderDashboard } from "./dashboard.js";
import { ensureSeed, createDemoData } from "./seed.js";
import { toast, openModal, closeModal, bindModalDismiss, avatarHtml } from "./ui.js";

let currentView = "board";
let appStarted = false;
let lastRole = null;

// ============================================================
// Arranque
// ============================================================

async function boot() {
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
    startDataListeners();
    ensureSeed();
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
  $$("#nav-tabs [data-view]").forEach((btn) => {
    const view = VIEWS[btn.dataset.view];
    btn.classList.toggle("hidden", !view.allowed(user));
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
  $$("#nav-tabs [data-view]").forEach((btn) =>
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

function renderSettingsAdmin(container) {
  const cfg = store.config.app;
  container.innerHTML = `
    <div class="dash-card">
      <h4>Configuración general</h4>
      <p class="text-muted">Estos valores se definen en <code>src/config.js</code> y se reflejan en <code>firebase.rules</code>.</p>
      <ul class="settings-list">
        <li><strong>Nombre:</strong> ${escapeHtml(cfg.appName)}</li>
        <li><strong>Dominio permitido:</strong> @${escapeHtml(cfg.allowedDomain)}</li>
        <li><strong>SuperAdmins:</strong> ${cfg.superAdminEmails.map(escapeHtml).join(", ")}</li>
        <li><strong>Rol por defecto:</strong> ${escapeHtml(roleLabel(cfg.defaultRole))}</li>
        <li><strong>Modo demo:</strong> ${cfg.demoMode ? "Activado" : "Desactivado"}</li>
      </ul>
      ${cfg.demoMode ? `<button class="btn btn-ghost" id="btn-demo-data">Generar datos demo</button>` : ""}
    </div>`;

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

  // Navegación
  $$("#nav-tabs [data-view]").forEach((btn) => {
    btn.addEventListener("click", () => route(btn.dataset.view));
  });

  // Nuevo ticket
  $("#btn-new-ticket").addEventListener("click", () => openTicketForm());

  // Filtro de estado del tablero
  $("#board-status-filter").addEventListener("change", renderBoard);

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
  });
  on("notifications:changed", () => {
    if (!appStarted) return;
    renderNotificationsPanel(openFromNotification);
  });
}

boot();
