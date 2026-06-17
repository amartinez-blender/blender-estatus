// sla.js — Motor de estatus SLA (calculado en vivo, no se persiste).
// Reglas (reqs. 3, 4, 5):
//   Columna "Fabricación":
//     - sin "Fecha y Hora en Almacén"  → cuenta regresiva = entrada + SLA Producción.
//         dentro de tiempo → "Tarea en Tiempo · Asignar Fecha y Hora Promesa"
//         vencida          → "Tarea Atrasada · Asignar Fecha y Hora Promesa"
//     - con fecha asignada → cuenta hacia esa fecha.
//         vencida → "Tarea Atrasada · Cambiar a Almacén"
//   Columna "Almacén":
//     - sin "Fecha y Hora para Listo" → cuenta regresiva = entrada + SLA Almacén.
//     - con fecha asignada → vencida → "Tarea Atrasada · Cambiar a Listos para recolección"

import { toDate, normalize, durationToMs } from "./utils.js";
import { columnName } from "./columns.js";
import { getSla } from "./settings.js";
import { addBusinessMs, businessMsBetween } from "./businesstime.js";

export const SLA_COLUMNS = {
  COTIZACION: "Cotización de envío",
  COTIZACION_LISTA: "Cotización de envío lista",
  ADMINISTRACION: "Administración",
  FABRICACION: "Fabricación",
  ALMACEN: "Almacén",
  LISTOS: "Listos para recolección",
};

function build(late, action, deadline) {
  return {
    late,
    action,
    deadline,
    // Tiempo HÁBIL restante (no avanza de noche, fines de semana ni festivos).
    remainingMs: businessMsBetween(Date.now(), deadline),
    label: `${late ? "Tarea Atrasada" : "Tarea en Tiempo"} · ${action}`,
  };
}

// Devuelve el estado SLA del ticket, o null si su columna no aplica.
export function computeSla(ticket) {
  if (!ticket || ticket.status !== "Activo") return null;

  const col = normalize(columnName(ticket.columnId));
  const sla = getSla();
  const now = Date.now();
  const enteredAt =
    toDate(ticket.lastMovedAt)?.getTime() ??
    toDate(ticket.updatedAt)?.getTime() ??
    toDate(ticket.createdAt)?.getTime() ??
    now;

  if (col === normalize(SLA_COLUMNS.COTIZACION)) {
    // El timer corre mientras no se haya llenado el Costo de envío (req. 4).
    if (ticket.shippingCost == null || ticket.shippingCost === "") {
      const deadline = addBusinessMs(enteredAt, durationToMs(sla.quote)).getTime();
      return build(now > deadline, "Cotizar envío", deadline);
    }
    return null; // ya cotizado (debería haber pasado a "Cotización de envío lista")
  }

  if (col === normalize(SLA_COLUMNS.ADMINISTRACION)) {
    // El timer corre hasta que Administración marca "Pago Confirmado" (req. 7).
    if (!ticket.paymentConfirmed) {
      const deadline = addBusinessMs(enteredAt, durationToMs(sla.admin)).getTime();
      return build(now > deadline, "Confirmar Pago", deadline);
    }
    return null;
  }

  if (col === normalize(SLA_COLUMNS.FABRICACION)) {
    if (!ticket.promiseDateWarehouse) {
      const deadline = addBusinessMs(enteredAt, durationToMs(sla.production)).getTime();
      return build(now > deadline, "Asignar Fecha y Hora Promesa", deadline);
    }
    const deadline = new Date(ticket.promiseDateWarehouse).getTime();
    return build(now > deadline, "Cambiar a Almacén", deadline);
  }

  if (col === normalize(SLA_COLUMNS.ALMACEN)) {
    if (!ticket.promiseDateReady) {
      const deadline = addBusinessMs(enteredAt, durationToMs(sla.warehouse)).getTime();
      return build(now > deadline, "Asignar Fecha y Hora Promesa", deadline);
    }
    const deadline = new Date(ticket.promiseDateReady).getTime();
    return build(now > deadline, "Cambiar a Listos para recolección", deadline);
  }

  return null;
}

// Helpers de columna usados por la UI del detalle.
export function isFabricacionColumn(ticket) {
  return normalize(columnName(ticket?.columnId)) === normalize(SLA_COLUMNS.FABRICACION);
}
export function isAlmacenColumn(ticket) {
  return normalize(columnName(ticket?.columnId)) === normalize(SLA_COLUMNS.ALMACEN);
}
export function isCotizacionColumn(ticket) {
  return normalize(columnName(ticket?.columnId)) === normalize(SLA_COLUMNS.COTIZACION);
}
export function isCotizacionListaColumn(ticket) {
  return normalize(columnName(ticket?.columnId)) === normalize(SLA_COLUMNS.COTIZACION_LISTA);
}
export function isAdministracionColumn(ticket) {
  return normalize(columnName(ticket?.columnId)) === normalize(SLA_COLUMNS.ADMINISTRACION);
}
