// users.js — Datos de usuarios + sección "Usuarios" del panel Admin.

import {
  fb, collection, doc, updateDoc, onSnapshot, serverTimestamp,
} from "./firebase.js";
import { store, emit, escapeHtml, $ } from "./utils.js";
import { ROLES, ASSIGNABLE_ROLES, roleLabel, isValidRole } from "./roles.js";
import { can } from "./permissions.js";
import { toast, confirmDialog, avatarHtml } from "./ui.js";

// ===================== Datos =====================

export function listenUsers() {
  store.unsubs.users?.();
  store.unsubs.users = onSnapshot(
    collection(fb.db, "users"),
    (snap) => {
      store.users = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
      emit("users:changed", store.users);
    },
    (err) => console.error("[users] listener:", err)
  );
}

export function getUser(uid) {
  return store.users.find((u) => u.uid === uid || u.id === uid) || null;
}

export function userName(uid) {
  return getUser(uid)?.displayName || "Usuario";
}

// Vendedores que pueden ser responsables de un ticket.
export function sellableUsers() {
  return store.users.filter(
    (u) =>
      u.active !== false &&
      [ROLES.SUPERADMIN, ROLES.SALES_ADMIN, ROLES.SALES_EXEC].includes(u.role)
  );
}

export async function setUserRole(uid, role) {
  if (!isValidRole(role)) throw new Error("Rol inválido.");
  await updateDoc(doc(fb.db, "users", uid), { role });
}

export async function setUserActive(uid, active) {
  await updateDoc(doc(fb.db, "users", uid), { active: !!active });
}

// ID de Google Chat del usuario (para @menciones reales en el webhook).
export async function setUserChatId(uid, chatUserId) {
  await updateDoc(doc(fb.db, "users", uid), {
    chatUserId: String(chatUserId || "").trim(),
  });
}

export async function updateMyProfile({ phone }) {
  const uid = store.currentUser?.uid;
  if (!uid) return;
  await updateDoc(doc(fb.db, "users", uid), {
    phone: String(phone || "").trim(),
    updatedAt: serverTimestamp(),
  });
}

// ===================== Render: Admin > Usuarios =====================

export function renderUsersAdmin(container) {
  const me = store.currentUser;
  const canEditRole = can(me, "users:editRole");
  const canToggle = can(me, "users:toggleActive");

  if (!store.users.length) {
    container.innerHTML = `<div class="empty-state">Sin usuarios registrados.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="admin-list">
      ${store.users.map((u) => `
        <div class="admin-user-card ${u.active === false ? "is-inactive" : ""}" data-uid="${u.id}">
          <div class="admin-user-main">
            ${avatarHtml(u, 40)}
            <div class="admin-user-info">
              <strong>${escapeHtml(u.displayName)}</strong>
              <span class="text-muted">${escapeHtml(u.email)}</span>
              <span class="text-muted">${escapeHtml(u.phone || "Sin teléfono")}</span>
              ${canEditRole ? `
                <label class="chatid-field">
                  <span class="text-muted">ID de Google Chat</span>
                  <input class="input input-sm input-chatid" placeholder="p. ej. 1234567890"
                    value="${escapeHtml(u.chatUserId || "")}" aria-label="ID de Chat de ${escapeHtml(u.displayName)}">
                </label>` : ""}
            </div>
          </div>
          <div class="admin-user-actions">
            ${canEditRole ? `
              <select class="input select-role" aria-label="Rol de ${escapeHtml(u.displayName)}">
                ${ASSIGNABLE_ROLES.map((r) =>
                  `<option value="${r}" ${u.role === r ? "selected" : ""}>${roleLabel(r)}</option>`
                ).join("")}
              </select>` : `
              <span class="badge badge-role">${roleLabel(u.role)}</span>`}
            ${canToggle ? `
              <button class="btn btn-ghost btn-toggle-active">
                ${u.active === false ? "Activar" : "Desactivar"}
              </button>` : `
              <span class="badge ${u.active === false ? "badge-danger" : "badge-ok"}">
                ${u.active === false ? "Inactivo" : "Activo"}
              </span>`}
          </div>
        </div>`).join("")}
    </div>`;

  if (canEditRole) {
    container.querySelectorAll(".select-role").forEach((sel) => {
      sel.addEventListener("change", async (e) => {
        const card = e.target.closest("[data-uid]");
        const user = getUser(card.dataset.uid);
        try {
          await setUserRole(card.dataset.uid, e.target.value);
          toast(`Rol de ${user?.displayName || "usuario"} actualizado.`, "success");
        } catch (err) {
          toast("No se pudo cambiar el rol: " + err.message, "error");
        }
      });
    });

    // Guardar ID de Chat al salir del campo (si cambió).
    container.querySelectorAll(".input-chatid").forEach((inp) => {
      inp.addEventListener("change", async (e) => {
        const card = e.target.closest("[data-uid]");
        const user = getUser(card.dataset.uid);
        if ((user?.chatUserId || "") === e.target.value.trim()) return;
        try {
          await setUserChatId(card.dataset.uid, e.target.value);
          toast(`ID de Chat de ${user?.displayName || "usuario"} guardado.`, "success");
        } catch (err) {
          toast("No se pudo guardar el ID: " + err.message, "error");
        }
      });
    });
  }

  if (canToggle) {
    container.querySelectorAll(".btn-toggle-active").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const card = e.target.closest("[data-uid]");
        const user = getUser(card.dataset.uid);
        const deactivating = user?.active !== false;
        if (user?.uid === store.currentUser.uid && deactivating) {
          toast("No puedes desactivar tu propia cuenta.", "error");
          return;
        }
        const ok = await confirmDialog({
          title: deactivating ? "Desactivar usuario" : "Activar usuario",
          message: `¿${deactivating ? "Desactivar" : "Activar"} a ${user?.displayName}?`,
          confirmText: deactivating ? "Desactivar" : "Activar",
          danger: deactivating,
        });
        if (!ok) return;
        try {
          await setUserActive(card.dataset.uid, !deactivating);
          toast("Usuario actualizado.", "success");
        } catch (err) {
          toast("Error: " + err.message, "error");
        }
      });
    });
  }
}
