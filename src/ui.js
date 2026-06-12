// ui.js — Helpers de interfaz reutilizables: toasts, modales, confirmación,
// avatares, badges y estados. No duplicar estos helpers en otros módulos.

import { $, escapeHtml, initials } from "./utils.js";

// ===================== Toasts =====================
export function toast(message, type = "info", ms = 3500) {
  const box = $("#toast-container");
  if (!box) return;
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.setAttribute("role", "status");
  el.textContent = message;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, ms);
}

// ===================== Modales =====================
export function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.add("open");
  document.body.classList.add("modal-open");
}

export function closeModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove("open");
  if (!document.querySelector(".modal.open")) {
    document.body.classList.remove("modal-open");
  }
}

// Cerrar al hacer clic en el fondo o en [data-close].
export function bindModalDismiss() {
  document.querySelectorAll(".modal").forEach((m) => {
    m.addEventListener("click", (e) => {
      if (e.target === m || e.target.closest("[data-close]")) {
        m.dispatchEvent(new CustomEvent("modal:close"));
        closeModal(m.id);
      }
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal.open").forEach((m) => {
        m.dispatchEvent(new CustomEvent("modal:close"));
        closeModal(m.id);
      });
    }
  });
}

// ===================== Confirmación =====================
export function confirmDialog({ title = "¿Confirmar?", message = "", confirmText = "Confirmar", danger = false }) {
  return new Promise((resolve) => {
    $("#confirm-title").textContent = title;
    $("#confirm-message").textContent = message;
    const yes = $("#btn-confirm-yes");
    const no = $("#btn-confirm-no");
    yes.textContent = confirmText;
    yes.classList.toggle("btn-danger", danger);
    yes.classList.toggle("btn-primary", !danger);

    const done = (result) => {
      yes.removeEventListener("click", onYes);
      no.removeEventListener("click", onNo);
      $("#confirm-modal").removeEventListener("modal:close", onNo);
      closeModal("confirm-modal");
      resolve(result);
    };
    const onYes = () => done(true);
    const onNo = () => done(false);

    yes.addEventListener("click", onYes);
    no.addEventListener("click", onNo);
    $("#confirm-modal").addEventListener("modal:close", onNo, { once: true });
    openModal("confirm-modal");
  });
}

// ===================== Avatares y badges =====================
export function avatarHtml(user, size = 32) {
  const name = escapeHtml(user?.displayName || "?");
  if (user?.photoURL) {
    return `<img class="avatar" src="${escapeHtml(user.photoURL)}" alt="${name}"
      title="${name}" width="${size}" height="${size}" referrerpolicy="no-referrer">`;
  }
  return `<span class="avatar avatar-initials" title="${name}"
    style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px">${initials(user?.displayName)}</span>`;
}

const PRIORITY_CLASS = { Baja: "low", Media: "medium", Alta: "high", Urgente: "urgent" };
export function priorityBadge(priority) {
  if (!priority) return "";
  return `<span class="badge badge-priority priority-${PRIORITY_CLASS[priority] || "low"}">${escapeHtml(priority)}</span>`;
}

const STATUS_CLASS = { Activo: "ok", Cerrado: "muted", Cancelado: "danger" };
export function statusBadge(status) {
  if (!status) return "";
  return `<span class="badge badge-${STATUS_CLASS[status] || "muted"}">${escapeHtml(status)}</span>`;
}

// ===================== Estados =====================
export function emptyState(message, icon = "📭") {
  return `<div class="empty-state"><span class="empty-icon">${icon}</span><p>${escapeHtml(message)}</p></div>`;
}

export function loadingState(message = "Cargando…") {
  return `<div class="loading-state"><span class="spinner"></span><p>${escapeHtml(message)}</p></div>`;
}

export function setSaving(btn, saving, label = null) {
  if (!btn) return;
  if (saving) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner spinner-sm"></span> Guardando…`;
  } else {
    btn.disabled = false;
    btn.textContent = label || btn.dataset.label || btn.textContent;
  }
}
