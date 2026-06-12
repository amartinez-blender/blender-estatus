// notifications.js — Notificaciones in-app.
// Sin backend, el fan-out lo hace el cliente que ejecuta la acción.
// Preparado para FCM en fase 2: bastaría agregar el envío push en notifyUsers().

import {
  fb, collection, doc, query, where, onSnapshot, updateDoc, writeBatch, serverTimestamp,
} from "./firebase.js";
import { store, emit, escapeHtml, relativeTime, toDate, $ } from "./utils.js";

// Tipos: moved | comment | mention | attachment | updated | production_in | warehouse_in

// ===================== Listener =====================
// Query solo con `where` (sin orderBy) para no requerir índice compuesto;
// se ordena en cliente.
export function listenMyNotifications() {
  const uid = store.currentUser?.uid;
  if (!uid) return;
  store.unsubs.notifications?.();
  const q = query(collection(fb.db, "notifications"), where("recipientId", "==", uid));
  store.unsubs.notifications = onSnapshot(
    q,
    (snap) => {
      store.notifications = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0))
        .slice(0, 100);
      emit("notifications:changed", store.notifications);
    },
    (err) => console.error("[notifications] listener:", err)
  );
}

export function unreadCount() {
  return store.notifications.filter((n) => !n.read).length;
}

// ===================== Crear =====================

// recipients: array de uids. Omite al actor y duplicados.
export async function notifyUsers(recipientIds, { ticketId = null, type, title, message }) {
  const me = store.currentUser?.uid;
  const unique = [...new Set(recipientIds)].filter((uid) => uid && uid !== me);
  if (!unique.length) return;
  const batch = writeBatch(fb.db);
  unique.forEach((recipientId) => {
    batch.set(doc(collection(fb.db, "notifications")), {
      recipientId,
      ticketId,
      type,
      title,
      message,
      read: false,
      createdAt: serverTimestamp(),
    });
  });
  try {
    await batch.commit();
  } catch (err) {
    console.error("[notifications] No se pudieron crear:", err);
  }
}

// Notifica a todos los usuarios activos con un rol dado (p. ej. Producción).
export async function notifyRole(role, payload) {
  const recipients = store.users
    .filter((u) => u.role === role && u.active !== false)
    .map((u) => u.uid || u.id);
  await notifyUsers(recipients, payload);
}

// ===================== Marcar leídas =====================

export async function markRead(id) {
  await updateDoc(doc(fb.db, "notifications", id), { read: true });
}

export async function markAllRead() {
  const unread = store.notifications.filter((n) => !n.read);
  if (!unread.length) return;
  const batch = writeBatch(fb.db);
  unread.forEach((n) => batch.update(doc(fb.db, "notifications", n.id), { read: true }));
  await batch.commit();
}

// ===================== Render del panel =====================

const TYPE_ICONS = {
  moved: "↔️", comment: "💬", mention: "🏷️", attachment: "📎",
  updated: "✏️", production_in: "🏭", warehouse_in: "📦",
};

export function renderNotificationsPanel(onOpenTicket) {
  const list = $("#notif-list");
  const badge = $("#notif-badge");
  const count = unreadCount();

  badge.textContent = count > 99 ? "99+" : String(count);
  badge.classList.toggle("hidden", count === 0);

  if (!store.notifications.length) {
    list.innerHTML = `<div class="empty-state empty-sm">Sin notificaciones.</div>`;
    return;
  }

  list.innerHTML = store.notifications.map((n) => `
    <button class="notif-item ${n.read ? "" : "is-unread"}" data-id="${n.id}" data-ticket="${n.ticketId || ""}">
      <span class="notif-icon">${TYPE_ICONS[n.type] || "🔔"}</span>
      <span class="notif-body">
        <strong>${escapeHtml(n.title)}</strong>
        <span>${escapeHtml(n.message)}</span>
        <time>${relativeTime(n.createdAt)}</time>
      </span>
    </button>`).join("");

  list.querySelectorAll(".notif-item").forEach((item) => {
    item.addEventListener("click", async () => {
      const n = store.notifications.find((x) => x.id === item.dataset.id);
      if (n && !n.read) markRead(n.id).catch(() => {});
      if (item.dataset.ticket && onOpenTicket) onOpenTicket(item.dataset.ticket);
    });
  });
}
