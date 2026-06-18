// permissions.js — Lógica centralizada de permisos.
// REGLA DEL PROYECTO: nadie compara user.role fuera de este archivo
// (excepción documentada: queries por rol en tickets.js).
//
// Uso: can(user, "ticket:edit", ticket)
// Estas mismas reglas están reflejadas en firebase.rules.

import { ROLES, ROLE_TREATMENT } from "./roles.js";
import { normalize } from "./utils.js";

function ownsTicket(user, ticket) {
  return !!ticket && (ticket.ownerId === user.uid || ticket.createdBy === user.uid);
}

// Columna del recurso (si el llamador la adjuntó como _columnName).
function colMatches(resource, ...names) {
  const c = resource?._columnName;
  if (!c) return true; // sin contexto de columna no se restringe
  return names.map(normalize).includes(normalize(c));
}

function treatmentMatches(user, ticket) {
  return !!ticket && ticket.treatment === ROLE_TREATMENT[user.role];
}

export function can(user, action, resource = null) {
  if (!user || user.active === false || user.role === ROLES.PENDING) return false;
  const r = user.role;
  if (r === ROLES.SUPERADMIN) return true;

  switch (action) {
    // ---------- Tickets ----------
    // Req. 6: todos los roles (activos, no pendientes) ven todas las tarjetas.
    case "ticket:view":
      return true;

    case "ticket:create":
      return r === ROLES.SALES_ADMIN || r === ROLES.SALES_EXEC;

    case "ticket:edit":
      if (r === ROLES.SALES_ADMIN) return true;
      if (r === ROLES.SALES_EXEC) return ownsTicket(user, resource);
      return false;

    case "ticket:move":
      if (r === ROLES.SALES_ADMIN) return true;
      // Producción mueve solo desde la columna Fabricación (req. 6).
      if (r === ROLES.PRODUCTION)
        return treatmentMatches(user, resource) && colMatches(resource, "Fabricación");
      // Almacén mueve solo desde Cotización de envío o Almacén (req. 5).
      if (r === ROLES.WAREHOUSE)
        return treatmentMatches(user, resource) && colMatches(resource, "Almacén", "Cotización de envío");
      return false;

    case "ticket:assignOwner": // cambiar vendedor responsable
      return r === ROLES.SALES_ADMIN;

    // Cancelar/cerrar ticket: NUNCA Producción, Almacén ni Auditor (req. 9 y 10).
    // Solo quien puede editar el ticket (SuperAdmin, Admin de Ventas, dueño Ejecutivo).
    case "ticket:cancel":
    case "ticket:close":
      if (r === ROLES.SALES_ADMIN) return true;
      if (r === ROLES.SALES_EXEC) return ownsTicket(user, resource);
      return false;

    // Fecha y Hora en Almacén → solo Producción (en tickets de Fabricación).
    case "ticket:setProductionPromise":
      return r === ROLES.PRODUCTION && treatmentMatches(user, resource);

    // Fecha y Hora para Listo → solo Almacén (en tickets de Almacén).
    case "ticket:setWarehousePromise":
      return r === ROLES.WAREHOUSE && treatmentMatches(user, resource);

    // Costo de envío → solo Almacén. Al guardarlo la tarjeta se mueve sola a
    // "Cotización de envío lista" (las reglas permiten ese movimiento a Almacén
    // para tickets que requieren envío).
    case "ticket:setShippingCost":
      return r === ROLES.WAREHOUSE;

    // Tipo de pago → solo Ejecutivo de Ventas (dueño). Mandatorio al crear.
    case "ticket:setPaymentType":
      return r === ROLES.SALES_EXEC && ownsTicket(user, resource);

    // Pago Confirmado → solo Administración, y solo en la columna Administración.
    case "ticket:confirmPayment":
      return r === ROLES.ADMINISTRATION && colMatches(resource, "Administración");

    // Aceptar/Rechazar el costo → solo el vendedor que CREÓ el ticket.
    case "ticket:decideCost":
      return (r === ROLES.SALES_EXEC || r === ROLES.SALES_ADMIN) &&
        resource?.createdBy === user.uid;

    // Confirmar "Envío Pagado por el cliente" → el vendedor asignado o el Admin de Ventas.
    case "ticket:markPaid":
      if (r === ROLES.SALES_ADMIN) return true;
      if (r === ROLES.SALES_EXEC) return resource?.ownerId === user.uid;
      return false;

    case "ticket:delete":
      return false; // solo SuperAdmin (cubierto arriba)

    // ---------- Comentarios y adjuntos ----------
    // resource = ticket
    case "comment:create":
    case "attachment:add":
      if (r === ROLES.AUDITOR) return false;
      if (r === ROLES.SALES_ADMIN || r === ROLES.ADMINISTRATION) return true;
      if (r === ROLES.SALES_EXEC) return ownsTicket(user, resource);
      if (r === ROLES.PRODUCTION || r === ROLES.WAREHOUSE) return treatmentMatches(user, resource);
      return false;

    // resource = { ticket, comment }
    case "comment:edit":
    case "comment:delete":
      return resource?.comment?.createdBy === user.uid &&
        can(user, "comment:create", resource?.ticket);

    // resource = { ticket, attachment }
    case "attachment:delete":
      return resource?.attachment?.uploadedBy === user.uid &&
        can(user, "attachment:add", resource?.ticket);

    // ---------- Vistas ----------
    // Req. 6: todos los roles pueden ver el Dashboard (solo lectura).
    case "dashboard:view":
      return true;

    case "activity:view": // resource = ticket
      return can(user, "ticket:view", resource);

    case "admin:view":
      return r === ROLES.SALES_ADMIN; // panel visible; acciones limitadas

    case "users:view":
      return r === ROLES.SALES_ADMIN;

    // ---------- Solo SuperAdmin ----------
    case "users:editRole":
    case "users:toggleActive":
    case "columns:manage":
    case "settings:manage":
      return false;

    default:
      return false;
  }
}

// Filtra tickets visibles para el usuario (defensa extra sobre las queries por rol).
export function visibleTickets(user, tickets) {
  return tickets.filter((t) => can(user, "ticket:view", t));
}
