// tickets.js — Capa de datos de tickets: queries por rol, CRUD, movimientos.
//
// NOTA (excepción documentada en AGENTS.md): aquí sí se consulta user.role,
// porque las reglas de Firestore no filtran queries — cada rol debe pedir
// exactamente lo que puede leer:
//   superadmin / sales_admin / auditor → todos los tickets
//   sales_exec → propios (ownerId == uid  ∪  createdBy == uid)
//   production → treatment == "Fabricación"
//   warehouse  → treatment == "Almacén"

import {
  fb, collection, doc, getDoc, setDoc, updateDoc, deleteDoc, query, where,
  onSnapshot, serverTimestamp, writeBatch,
} from "./firebase.js";
import { store, emit, validateTicketData, toDate } from "./utils.js";
import { ROLES, ROLE_TREATMENT } from "./roles.js";
import { logActivity } from "./activity.js";
import { notifyUsers, notifyRole } from "./notifications.js";
import { columnName } from "./columns.js";
import { userName } from "./users.js";

// ===================== Listeners por rol =====================

export function listenTickets() {
  stopTicketListeners();
  const user = store.currentUser;
  if (!user) return;

  const col = collection(fb.db, "tickets");
  let queries = [];

  switch (user.role) {
    case ROLES.SUPERADMIN:
    case ROLES.SALES_ADMIN:
    case ROLES.AUDITOR:
      queries = [query(col)];
      break;
    case ROLES.SALES_EXEC:
      queries = [
        query(col, where("ownerId", "==", user.uid)),
        query(col, where("createdBy", "==", user.uid)),
      ];
      break;
    case ROLES.PRODUCTION:
    case ROLES.WAREHOUSE:
      queries = [query(col, where("treatment", "==", ROLE_TREATMENT[user.role]))];
      break;
    default:
      store.tickets = [];
      emit("tickets:changed", []);
      return;
  }

  // Varias queries pueden traer el mismo doc: se fusionan por id.
  const buckets = queries.map(() => new Map());
  store.unsubs.tickets = [];

  queries.forEach((q, i) => {
    const unsub = onSnapshot(
      q,
      (snap) => {
        buckets[i].clear();
        snap.docs.forEach((d) => buckets[i].set(d.id, { id: d.id, ...d.data() }));
        const merged = new Map();
        buckets.forEach((b) => b.forEach((v, k) => merged.set(k, v)));
        store.tickets = [...merged.values()].sort(
          (a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0)
        );
        emit("tickets:changed", store.tickets);
      },
      (err) => console.error("[tickets] listener:", err)
    );
    store.unsubs.tickets.push(unsub);
  });
}

function stopTicketListeners() {
  (store.unsubs.tickets || []).forEach((u) => u?.());
  store.unsubs.tickets = [];
}

export function getTicket(id) {
  return store.tickets.find((t) => t.id === id) || null;
}

// ===================== Unicidad de orderNumber =====================
// /orderNumbers/{n} es create-only en firebase.rules: si el doc existe,
// el número está ocupado. Garantía a nivel servidor, no solo UI.

export async function isOrderNumberTaken(orderNumber) {
  const snap = await getDoc(doc(fb.db, "orderNumbers", String(orderNumber)));
  return snap.exists();
}

// ===================== CRUD =====================

export async function createTicket(data) {
  const user = store.currentUser;
  const errors = validateTicketData(data);
  if (errors.length) throw new Error(errors[0]);
  if (await isOrderNumberTaken(data.orderNumber)) {
    throw new Error(`El pedido ${data.orderNumber} ya existe.`);
  }

  const ticketRef = doc(collection(fb.db, "tickets"));
  const batch = writeBatch(fb.db);
  batch.set(doc(fb.db, "orderNumbers", String(data.orderNumber)), {
    ticketId: ticketRef.id,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
  });
  batch.set(ticketRef, {
    orderNumber: String(data.orderNumber),
    title: data.title || `Pedido ${data.orderNumber}`,
    treatment: data.treatment,
    shippingType: data.shippingType,
    deliveryMode: data.deliveryMode,
    addressNA: !!data.addressNA,
    shippingAddress: data.addressNA ? "" : data.shippingAddress.trim(),
    columnId: data.columnId,
    createdBy: user.uid,
    ownerId: data.ownerId || user.uid,
    priority: data.priority || null,
    status: "Activo",
    commentsCount: 0,
    attachmentsCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMovedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    // Carrera: otro usuario tomó el número entre la verificación y el commit.
    if (err.code === "permission-denied") {
      throw new Error(`El pedido ${data.orderNumber} ya existe o no tienes permisos.`);
    }
    throw err;
  }

  await logActivity(ticketRef.id, "created", `${user.displayName} creó el ticket.`);
  return ticketRef.id;
}

// Campos editables y su etiqueta para el historial.
const EDITABLE_LABELS = {
  title: "título",
  treatment: "tratamiento",
  shippingType: "tipo de envío",
  deliveryMode: "modalidad de entrega",
  addressNA: "dirección (N/A)",
  shippingAddress: "dirección de envío",
  priority: "prioridad",
};

export async function updateTicket(ticket, changes) {
  const user = store.currentUser;
  const merged = { ...ticket, ...changes };
  const errors = validateTicketData(merged);
  if (errors.length) throw new Error(errors[0]);

  const changedKeys = Object.keys(changes).filter((k) => changes[k] !== ticket[k]);
  if (!changedKeys.length) return;

  await updateDoc(doc(fb.db, "tickets", ticket.id), {
    ...changes,
    updatedAt: serverTimestamp(),
  });

  const ownerChanged = changedKeys.includes("ownerId");
  const fieldLabels = changedKeys
    .filter((k) => EDITABLE_LABELS[k])
    .map((k) => EDITABLE_LABELS[k]);

  if (ownerChanged) {
    await logActivity(ticket.id, "owner_changed",
      `${user.displayName} asignó el ticket a ${userName(changes.ownerId)}.`);
    await notifyUsers([changes.ownerId], {
      ticketId: ticket.id, type: "updated",
      title: `Pedido ${ticket.orderNumber}`,
      message: "Ahora eres el responsable de este ticket.",
    });
  }

  if (fieldLabels.length) {
    await logActivity(ticket.id, "updated",
      `${user.displayName} actualizó: ${fieldLabels.join(", ")}.`);
    await notifyUsers([ticket.ownerId], {
      ticketId: ticket.id, type: "updated",
      title: `Pedido ${ticket.orderNumber}`,
      message: `${user.displayName} actualizó ${fieldLabels.join(", ")}.`,
    });
  }
}

export async function moveTicket(ticket, toColumnId) {
  const user = store.currentUser;
  if (ticket.columnId === toColumnId) return;
  const fromName = columnName(ticket.columnId);
  const toName = columnName(toColumnId);

  await updateDoc(doc(fb.db, "tickets", ticket.id), {
    columnId: toColumnId,
    lastMovedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await logActivity(ticket.id, "moved",
    `${user.displayName} movió el ticket de ${fromName} a ${toName}.`,
    { from: ticket.columnId, to: toColumnId });

  await notifyUsers([ticket.ownerId], {
    ticketId: ticket.id, type: "moved",
    title: `Pedido ${ticket.orderNumber}`,
    message: `Movido de ${fromName} a ${toName} por ${user.displayName}.`,
  });

  // Avisos a equipos cuando el ticket entra a su columna.
  if (toName === "Fabricación") {
    await notifyRole(ROLES.PRODUCTION, {
      ticketId: ticket.id, type: "production_in",
      title: "Nuevo ticket en Fabricación",
      message: `Pedido ${ticket.orderNumber} entró a Fabricación.`,
    });
  }
  if (toName === "Almacén") {
    await notifyRole(ROLES.WAREHOUSE, {
      ticketId: ticket.id, type: "warehouse_in",
      title: "Nuevo ticket en Almacén",
      message: `Pedido ${ticket.orderNumber} entró a Almacén.`,
    });
  }
}

export async function setTicketStatus(ticket, status) {
  const user = store.currentUser;
  await updateDoc(doc(fb.db, "tickets", ticket.id), {
    status,
    updatedAt: serverTimestamp(),
  });
  await logActivity(ticket.id, "status_changed",
    `${user.displayName} marcó el ticket como ${status}.`);
  await notifyUsers([ticket.ownerId], {
    ticketId: ticket.id, type: "updated",
    title: `Pedido ${ticket.orderNumber}`,
    message: `El ticket fue marcado como ${status} por ${user.displayName}.`,
  });
}

// Solo SuperAdmin (reforzado en rules). Libera el número de pedido.
// Limitación MVP: las subcolecciones quedan huérfanas (ver README).
export async function deleteTicket(ticket) {
  const batch = writeBatch(fb.db);
  batch.delete(doc(fb.db, "tickets", ticket.id));
  batch.delete(doc(fb.db, "orderNumbers", String(ticket.orderNumber)));
  await batch.commit();
}
