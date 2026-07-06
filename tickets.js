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
  fb, collection, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, query, where,
  onSnapshot, serverTimestamp, writeBatch,
} from "./firebase.js";
import { store, emit, validateTicketData, toDate, fmtDateTime, fmtMoney, normalize, durationToMs,
  orderRef, ROUTING_COLUMN_NAMES, QUOTE_SHIPPING_TYPES, PAYMENT_METHODS } from "./utils.js";
import { ROLES, ROLE_TREATMENT } from "./roles.js";
import { logActivity } from "./activity.js";
import { notifyUsers, notifyRole } from "./notifications.js";
import { columnName, findColumnByName } from "./columns.js";
import { userName } from "./users.js";
import { sendGoogleChat } from "./chat.js";
import { getSla } from "./settings.js";
import { addBusinessMs, businessMsBetween } from "./businesstime.js";

// ===================== Listeners por rol =====================

export function listenTickets() {
  stopTicketListeners();
  const user = store.currentUser;
  if (!user || user.role === ROLES.PENDING) {
    store.tickets = [];
    emit("tickets:changed", []);
    return;
  }

  // Req. 6: TODOS los roles ven todas las tarjetas en Tablero y Dashboard.
  // La edición/movimiento sigue restringida por rol (ver permissions.js y reglas).
  const q = query(collection(fb.db, "tickets"));
  store.unsubs.tickets = [
    onSnapshot(
      q,
      (snap) => {
        store.tickets = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
        emit("tickets:changed", store.tickets);
      },
      (err) => console.error("[tickets] listener:", err)
    ),
  ];
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
    throw new Error(`La cotización ${data.orderNumber} ya existe.`);
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
    client: String(data.client || "").trim(), // Nombre del cliente (obligatorio, lo fija Ventas)
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
    tipoPago: data.tipoPago,    // "Contado" | "Crédito" (mandatorio, lo fija el Ejecutivo)
    paymentConfirmed: false,    // lo marca Administración antes de avanzar
    status: "Activo",
    promiseDateWarehouse: null, // "Fecha y Hora en Almacén" (lo asigna Producción)
    promiseDateReady: null,     // "Fecha y Hora para Listo" (lo asigna Almacén)
    shippingCost: null,         // Costo de envío en MXN (se llena en Cotización)
    pedidoNumber: null,         // # de pedido (se captura en la columna "Agregar Pedido")
    paymentMethod: null,        // Forma de pago que confirma Administración (Transferencia/Crédito)
    costDecision: null,         // null | "accepted" | "rejected" (decide el creador)
    shippingPaidByClient: false,// pre-pagado: el cliente ya pagó el envío
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
  // Notifica por rol según la columna a la que cayó el ticket (routing).
  await notifyColumnEntry({ id: ticketRef.id, orderNumber: String(data.orderNumber), client: String(data.client || "").trim(), ownerId: data.ownerId || user.uid },
    columnName(data.columnId));
  return ticketRef.id;
}

// Campos editables y su etiqueta para el historial.
const EDITABLE_LABELS = {
  title: "título",
  client: "cliente",
  treatment: "tratamiento",
  shippingType: "tipo de envío",
  deliveryMode: "modalidad de entrega",
  addressNA: "dirección (N/A)",
  shippingAddress: "dirección de envío",
  priority: "prioridad",
  tipoPago: "tipo de pago",
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
      title: orderRef(ticket),
      message: "Ahora eres el responsable de este ticket.",
    });
  }

  if (fieldLabels.length) {
    await logActivity(ticket.id, "updated",
      `${user.displayName} actualizó: ${fieldLabels.join(", ")}.`);
    await notifyUsers([ticket.ownerId], {
      ticketId: ticket.id, type: "updated",
      title: orderRef(ticket),
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
    title: orderRef(ticket),
    message: `Movido de ${fromName} a ${toName} por ${user.displayName}.`,
  });

  // Registra atraso al salir de una columna con fecha promesa vencida (req. 4).
  if (normalize(fromName) === normalize("Fabricación") && ticket.promiseDateWarehouse) {
    recordBreach(ticket, "Cambiar a Almacén",
      businessMsBetween(new Date(ticket.promiseDateWarehouse), new Date()));
  } else if (normalize(fromName) === normalize("Almacén") && ticket.promiseDateReady) {
    recordBreach(ticket, "Cambiar a Listos",
      businessMsBetween(new Date(ticket.promiseDateReady), new Date()));
  }

  // Aviso por rol al entrar a la columna correspondiente (reqs. 1, 3, 7, 8).
  await notifyColumnEntry(ticket, toName);
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
    title: orderRef(ticket),
    message: `El ticket fue marcado como ${status} por ${user.displayName}.`,
  });
}

// "Fecha y Hora en Almacén" — la asigna Producción (req. 1). ISO local string.
export async function setProductionPromise(ticket, isoDateTime) {
  const user = store.currentUser;
  // Atraso (en tiempo hábil) si se asignó fuera del SLA de Producción.
  const entered = toDate(ticket.lastMovedAt)?.getTime() ?? Date.now();
  const deadline = addBusinessMs(entered, durationToMs(getSla().production)).getTime();
  recordBreach(ticket, "Asignar fecha (Producción)", businessMsBetween(deadline, Date.now()));
  recordStepTime(ticket, "Fecha y Hora en Almacén");
  await updateDoc(doc(fb.db, "tickets", ticket.id), {
    promiseDateWarehouse: isoDateTime || null,
    updatedAt: serverTimestamp(),
  });
  await logActivity(ticket.id, "updated",
    `${user.displayName} asignó Fecha y Hora en Almacén: ${fmtDateTime(isoDateTime)}.`);
  await notifyUsers([ticket.ownerId], {
    ticketId: ticket.id, type: "updated",
    title: orderRef(ticket),
    message: `Producción asignó la Fecha y Hora en Almacén: ${fmtDateTime(isoDateTime)}.`,
  });
}

// "Fecha y Hora para Listo" — la asigna Almacén (req. 2). ISO local string.
export async function setWarehousePromise(ticket, isoDateTime) {
  const user = store.currentUser;
  const entered = toDate(ticket.lastMovedAt)?.getTime() ?? Date.now();
  const deadline = addBusinessMs(entered, durationToMs(getSla().warehouse)).getTime();
  recordBreach(ticket, "Asignar fecha (Almacén)", businessMsBetween(deadline, Date.now()));
  recordStepTime(ticket, "Fecha y Hora para Listo");
  await updateDoc(doc(fb.db, "tickets", ticket.id), {
    promiseDateReady: isoDateTime || null,
    updatedAt: serverTimestamp(),
  });
  await logActivity(ticket.id, "updated",
    `${user.displayName} asignó Fecha y Hora para Listo: ${fmtDateTime(isoDateTime)}.`);
  await notifyUsers([ticket.ownerId], {
    ticketId: ticket.id, type: "updated",
    title: orderRef(ticket),
    message: `Almacén asignó la Fecha y Hora para Listo: ${fmtDateTime(isoDateTime)}.`,
  });
}

// Costo de envío (req. 2). Al llenarlo, mueve la tarjeta a "Cotización de envío
// lista" (req. 6), registra historial, notifica in-app y avisa por Google Chat.
export async function setShippingCost(ticket, cost) {
  const user = store.currentUser;
  const amount = Number(cost);
  if (!isFinite(amount) || amount < 0) throw new Error("Costo de envío inválido.");

  // Atraso (en tiempo hábil) si se cotizó fuera del SLA de Cotización.
  const entered = toDate(ticket.lastMovedAt)?.getTime() ?? toDate(ticket.createdAt)?.getTime() ?? Date.now();
  const quoteDeadline = addBusinessMs(entered, durationToMs(getSla().quote)).getTime();
  // Atraso: solo el tiempo hábil VENCIDO (lo que excede el SLA). 0 si no venció.
  recordBreach(ticket, "Cotización de envío", businessMsBetween(quoteDeadline, Date.now()));
  recordStepTime(ticket, "Cotización de envío");

  const updates = {
    shippingCost: amount,
    costDecision: null, // nueva cotización: reinicia la decisión del vendedor
    updatedAt: serverTimestamp(),
  };

  // Auto-mover a "Cotización de envío lista" si la columna existe.
  const target = findColumnByName(ROUTING_COLUMN_NAMES.COTIZACION_LISTA);
  const willMove = target && target.id !== ticket.columnId;
  if (willMove) {
    updates.columnId = target.id;
    updates.lastMovedAt = serverTimestamp();
  }

  await updateDoc(doc(fb.db, "tickets", ticket.id), updates);

  await logActivity(ticket.id, "updated",
    `${user.displayName} asignó el Costo de envío: ${fmtMoney(amount)}.`);
  if (willMove) {
    await logActivity(ticket.id, "moved",
      `${user.displayName} movió el ticket a ${target.name} (cotización lista).`,
      { to: target.id });
  }

  // Avisa al Ejecutivo asignado/creador Y a todos los Administradores de Ventas,
  // para que cualquiera de ellos acepte o retroalimente el costo.
  const salesAdmins = store.users
    .filter((u) => u.role === ROLES.SALES_ADMIN && u.active !== false)
    .map((u) => u.uid || u.id);
  const targets = [...new Set([ticket.ownerId, ticket.createdBy, ...salesAdmins].filter(Boolean))];
  await notifyUsers(targets, {
    ticketId: ticket.id, type: "updated",
    title: orderRef(ticket),
    message: `Costo de envío: ${fmtMoney(amount)}. Acepta o retroalimenta el costo en "Cotización de envío lista".`,
  });

  // Aviso por Google Chat (webhook a un espacio; best-effort). Menciona al
  // vendedor asignado/creador y a los Administradores de Ventas.
  const people = [...new Set([ticket.ownerId, ticket.createdBy].filter(Boolean))].map((uid) => {
    const u = store.users.find((x) => (x.uid || x.id) === uid);
    return u?.chatUserId ? `<users/${u.chatUserId}>` : `@${u?.displayName || userName(uid)}`;
  });
  const mentions = [...new Set([...people, ...roleMentions(ROLES.SALES_ADMIN).split(" ").filter(Boolean)])].join(" ");
  await sendGoogleChat(
    `📦 *${orderRef(ticket)}* — cotización de envío lista. Costo: *${fmtMoney(amount)}*.\n` +
    `Acepta o retroalimenta el costo: ${mentions}`
  );
}

// Construye las menciones de Google Chat de todos los usuarios activos de un rol.
function roleMentions(role) {
  return store.users
    .filter((u) => u.role === role && u.active !== false)
    .map((u) => (u.chatUserId ? `<users/${u.chatUserId}>` : `@${u.displayName}`))
    .join(" ");
}

// Notifica cuando un ticket entra a una columna (in-app + Google Chat).
// Para columnas de equipos (Producción/Almacén/Administración) avisa a TODO el rol.
// Para etapas del Ejecutivo ("Agregar Pedido", "Listos") avisa SOLO al vendedor
// asignado al ticket (req. 10), no a todos los ejecutivos.
async function notifyColumnEntry(ticket, colNameStr) {
  const c = normalize(colNameStr);
  let roles = [], icon = "🔔", type = "moved", ownerOnly = false;
  if (c === normalize("Fabricación")) { roles = [ROLES.PRODUCTION]; icon = "🏭"; type = "production_in"; }
  else if (c === normalize("Almacén") || c === normalize("Cotización de envío")) { roles = [ROLES.WAREHOUSE]; icon = "📦"; type = "warehouse_in"; }
  // Administración: avisa al rol Administración Y al Administrador de Ventas (ambos confirman pago).
  else if (c === normalize("Administración")) { roles = [ROLES.ADMINISTRATION, ROLES.SALES_ADMIN]; icon = "🧾"; type = "updated"; }
  else if (c === normalize("Agregar Pedido")) { ownerOnly = true; icon = "🔢"; type = "updated"; }
  else if (c === normalize("Listos para recolección")) { ownerOnly = true; icon = "✅"; type = "moved"; }
  else return;

  if (ownerOnly) {
    // Solo el Ejecutivo que CREÓ y/o está ASIGNADO al ticket (no todo el rol).
    const targets = [...new Set([ticket.ownerId, ticket.createdBy].filter(Boolean))];
    await notifyUsers(targets, {
      ticketId: ticket.id, type,
      title: orderRef(ticket),
      message: `Entró a ${colNameStr}.`,
    });
    const mention = targets
      .map((uid) => {
        const u = store.users.find((x) => (x.uid || x.id) === uid);
        return u?.chatUserId ? `<users/${u.chatUserId}>` : `@${u?.displayName || userName(uid)}`;
      })
      .join(" ");
    await sendGoogleChat(`${icon} *${orderRef(ticket)}* entró a *${colNameStr}*. ${mention}`.trim());
    return;
  }

  for (const role of roles) {
    await notifyRole(role, {
      ticketId: ticket.id, type,
      title: orderRef(ticket),
      message: `Entró a ${colNameStr}.`,
    });
  }
  const mentions = [...new Set(roles.flatMap((role) => roleMentions(role).split(" ")))].join(" ");
  await sendGoogleChat(
    `${icon} *${orderRef(ticket)}* entró a *${colNameStr}*. ${mentions}`.trim()
  );
}

// Registra una incidencia de atraso en /slaBreaches para la analítica histórica
// del Dashboard (req. 4). No bloquea la operación principal.
function recordBreach(ticket, phase, lateMs) {
  if (!(lateMs > 0)) return;
  try {
    addDoc(collection(fb.db, "slaBreaches"), {
      ticketId: ticket.id,
      orderNumber: ticket.orderNumber,
      phase,
      lateMs: Math.round(lateMs),
      ownerId: ticket.ownerId || null,
      actorId: store.currentUser?.uid || null,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn("[sla] No se pudo registrar atraso:", err);
  }
}

// Registra el tiempo HÁBIL que tomó completar una acción (desde que el ticket
// entró a la etapa hasta ahora). Alimenta los "Tiempos promedio" del Dashboard.
// Se llama ANTES de mover/actualizar, para usar el lastMovedAt de entrada.
function recordStepTime(ticket, phase) {
  const entered = toDate(ticket.lastMovedAt)?.getTime()
    ?? toDate(ticket.createdAt)?.getTime() ?? Date.now();
  const ms = businessMsBetween(entered, Date.now());
  try {
    addDoc(collection(fb.db, "stepTimes"), {
      ticketId: ticket.id,
      orderNumber: ticket.orderNumber || null,
      phase,
      ms: Math.round(ms),
      ownerId: ticket.ownerId || null,
      actorId: store.currentUser?.uid || null,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn("[stepTime] No se pudo registrar:", err);
  }
}

const isPrepaid = (t) => normalize(t.shippingType) === normalize("Envío pre-pagado");

// El vendedor creador ACEPTA el costo.
//  - "Envío por cobrar": pasa a Administración.
//  - "Envío pre-pagado": queda aceptada; avanza al confirmar el pago del cliente.
// El # de pedido NO se captura aquí, sino en la columna "Agregar Pedido".
export async function acceptShippingCost(ticket) {
  const user = store.currentUser;
  recordStepTime(ticket, "Confirmar costo de envío");

  if (isPrepaid(ticket)) {
    await updateDoc(doc(fb.db, "tickets", ticket.id), {
      costDecision: "accepted",
      updatedAt: serverTimestamp(),
    });
    await logActivity(ticket.id, "updated",
      `${user.displayName} aceptó el costo de envío. Falta confirmar "Envío Pagado por el cliente".`);
    await notifyUsers([ticket.ownerId], {
      ticketId: ticket.id, type: "updated",
      title: orderRef(ticket),
      message: "Costo aceptado. Marca 'Envío Pagado por el cliente' para continuar.",
    });
    return;
  }

  // Envío por cobrar → pasa a Administración.
  const target = findColumnByName(ROUTING_COLUMN_NAMES.ADMINISTRACION);
  const updates = { costDecision: "accepted", updatedAt: serverTimestamp() };
  if (target) { updates.columnId = target.id; updates.lastMovedAt = serverTimestamp(); }
  await updateDoc(doc(fb.db, "tickets", ticket.id), updates);
  await logActivity(ticket.id, "updated",
    `${user.displayName} aceptó el costo de envío.${target ? ` Pasó a ${target.name}.` : ""}`);
  if (target) {
    await notifyUsers([ticket.ownerId], {
      ticketId: ticket.id, type: "moved",
      title: orderRef(ticket), message: `Pasó a ${target.name}.`,
    });
    await notifyColumnEntry(ticket, target.name);
  }
}

// Pre-pagado: el vendedor asignado o el Admin de Ventas confirma el pago del
// cliente y la tarjeta pasa a la columna Administración (gate antes de Fab/Alm).
export async function markShippingPaid(ticket) {
  const user = store.currentUser;
  const target = findColumnByName(ROUTING_COLUMN_NAMES.ADMINISTRACION);
  const updates = { shippingPaidByClient: true, updatedAt: serverTimestamp() };
  if (target) { updates.columnId = target.id; updates.lastMovedAt = serverTimestamp(); }
  await updateDoc(doc(fb.db, "tickets", ticket.id), updates);
  await logActivity(ticket.id, "updated",
    `${user.displayName} marcó "Envío Pagado por el cliente".${target ? ` Pasó a ${target.name}.` : ""}`);
  if (target) {
    await notifyUsers([ticket.ownerId], {
      ticketId: ticket.id, type: "moved",
      title: orderRef(ticket), message: `Pasó a ${target.name}.`,
    });
    await notifyColumnEntry(ticket, target.name);
  }
}

// El vendedor creador RECHAZA el costo: la tarjeta vuelve a "Cotización de envío",
// se limpia el costo y el timer de cotización se reinicia (reglas originales).
export async function rejectShippingCost(ticket) {
  const user = store.currentUser;
  const target = findColumnByName(ROUTING_COLUMN_NAMES.COTIZACION);
  const updates = {
    shippingCost: null,
    costDecision: "rejected",
    shippingPaidByClient: false,
    updatedAt: serverTimestamp(),
  };
  if (target) { updates.columnId = target.id; updates.lastMovedAt = serverTimestamp(); }
  await updateDoc(doc(fb.db, "tickets", ticket.id), updates);
  await logActivity(ticket.id, "updated",
    `${user.displayName} rechazó el costo de envío. Regresó a Cotización de envío para recotizar.`);
  await notifyUsers([ticket.ownerId], {
    ticketId: ticket.id, type: "updated",
    title: orderRef(ticket),
    message: "El costo de envío fue rechazado. Se requiere recotizar.",
  });
  await notifyRole(ROLES.WAREHOUSE, {
    ticketId: ticket.id, type: "updated",
    title: "Recotizar envío",
    message: `El pedido ${ticket.orderNumber} requiere un nuevo costo de envío.`,
  });
  await sendGoogleChat(
    `🔁 *${orderRef(ticket)}* — costo rechazado, requiere recotizar. ${roleMentions(ROLES.WAREHOUSE)}`.trim()
  );
}

// Administración marca "Pago Confirmado" y la forma de pago (Transferencia/Crédito).
// La tarjeta avanza a la columna "Agregar Pedido" para que el Ejecutivo capture
// el # de pedido. Se avisa al Ejecutivo de Ventas asignado (reqs. 3, 5, 8).
export async function confirmPayment(ticket, paymentMethod) {
  const user = store.currentUser;
  const method = String(paymentMethod || "").trim();
  if (!PAYMENT_METHODS.includes(method)) {
    throw new Error("Selecciona una forma de pago válida.");
  }

  // Atraso (en tiempo hábil) si se confirmó fuera del SLA de Administración.
  const entered = toDate(ticket.lastMovedAt)?.getTime() ?? Date.now();
  const deadline = addBusinessMs(entered, durationToMs(getSla().admin)).getTime();
  recordBreach(ticket, "Confirmar Pago", businessMsBetween(deadline, Date.now()));
  recordStepTime(ticket, "Confirmar pago");

  const target = findColumnByName(ROUTING_COLUMN_NAMES.AGREGAR_PEDIDO);
  const updates = { paymentConfirmed: true, paymentMethod: method, updatedAt: serverTimestamp() };
  if (target) { updates.columnId = target.id; updates.lastMovedAt = serverTimestamp(); }
  await updateDoc(doc(fb.db, "tickets", ticket.id), updates);

  await logActivity(ticket.id, "updated",
    `${user.displayName} confirmó el pago (${method}).${target ? ` Pasó a ${target.name}.` : ""}`);

  // Aviso al Ejecutivo de Ventas asignado: debe capturar el # de pedido.
  await notifyUsers([ticket.ownerId], {
    ticketId: ticket.id, type: "updated",
    title: orderRef(ticket),
    message: `Pago Confirmado (${method}). Captura el # de pedido en "Agregar Pedido".`,
  });
  if (target) await notifyColumnEntry(ticket, target.name);
}

// El Ejecutivo de Ventas captura el # de pedido en la columna "Agregar Pedido".
// Al guardarlo, la tarjeta avanza a Fabricación o Almacén según el Tratamiento.
export async function addPedido(ticket, pedidoNumber) {
  const user = store.currentUser;
  const pedido = String(pedidoNumber || "").trim();
  if (!/^\d{1,10}$/.test(pedido)) {
    throw new Error("Captura un # de pedido válido (solo números).");
  }
  recordStepTime(ticket, "Agregar # de pedido");
  const target = findColumnByName(ticket.treatment); // "Fabricación" o "Almacén"
  const updates = { pedidoNumber: pedido, updatedAt: serverTimestamp() };
  if (target) { updates.columnId = target.id; updates.lastMovedAt = serverTimestamp(); }
  await updateDoc(doc(fb.db, "tickets", ticket.id), updates);

  await logActivity(ticket.id, "updated",
    `${user.displayName} asignó el # de pedido ${pedido}.${target ? ` Pasó a ${target.name}.` : ""}`);

  const moved = { ...ticket, pedidoNumber: pedido };
  await notifyUsers([ticket.ownerId], {
    ticketId: ticket.id, type: "moved",
    title: orderRef(moved), message: target ? `Pasó a ${target.name}.` : "# de pedido asignado.",
  });
  if (target) await notifyColumnEntry(moved, target.name);
}

// Solo SuperAdmin (reforzado en rules). Libera el número de pedido.
// Limitación MVP: las subcolecciones quedan huérfanas (ver README).
export async function deleteTicket(ticket) {
  const batch = writeBatch(fb.db);
  batch.delete(doc(fb.db, "tickets", ticket.id));
  batch.delete(doc(fb.db, "orderNumbers", String(ticket.orderNumber)));
  await batch.commit();
}
