// permissions.js — Lógica centralizada de permisos.
// REGLA DEL PROYECTO: nadie compara user.role fuera de este archivo
// (excepción documentada: queries por rol en tickets.js).
//
// Uso: can(user, "ticket:edit", ticket)
// Estas mismas reglas están reflejadas en firebase.rules.

import { ROLES, ROLE_TREATMENT } from "./roles.js";
import { normalize, store } from "./utils.js";

// Override del SuperAdmin (matriz de permisos en Admin): si una capacidad está
// explícitamente apagada para un rol, se niega. No puede CONCEDER más allá de lo
// que ya permite el rol por defecto (las reglas del servidor son la verdad).
function isDisabledByAdmin(role, action) {
  const ov = store.settings?.permissions;
  return !!(ov && ov[role] && ov[role][action] === false);
}

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

  // Apagado explícito por el SuperAdmin (matriz de permisos).
  if (isDisabledByAdmin(r, action)) return false;

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
      // Almacén mueve por COLUMNA (las etapas que atiende), sin importar el tratamiento.
      if (r === ROLES.WAREHOUSE)
        return colMatches(resource, "Almacén", "Cotización de envío", "Cotización de envío lista");
      return false;

    case "ticket:assignOwner": // cambiar vendedor responsable
      return r === ROLES.SALES_ADMIN;

    // Cancelar/cerrar ticket: NUNCA Producción, Almacén ni Auditor (req. 9 y 10).
    // Solo quien puede editar el ticket (SuperAdmin, Admin de Ventas, dueño Ejecutivo).
    case "ticket:cancel":
      if (r === ROLES.SALES_ADMIN) return true;
      if (r === ROLES.SALES_EXEC) return ownsTicket(user, resource);
      return false;

    case "ticket:close":
      if (r === ROLES.SALES_ADMIN) return true;
      if (r === ROLES.SALES_EXEC) return ownsTicket(user, resource);
      // Almacén cierra SOLO en "Listos para recolección" y con evidencia adjunta.
      if (r === ROLES.WAREHOUSE)
        return colMatches(resource, "Listos para recolección") && (resource?.attachmentsCount || 0) > 0;
      return false;

    // Fecha y Hora en Almacén → Producción, según la COLUMNA Fabricación.
    case "ticket:setProductionPromise":
      return r === ROLES.PRODUCTION && colMatches(resource, "Fabricación");

    // Fecha y Hora para Listo → Almacén, según la COLUMNA Almacén
    // (independiente del tratamiento del pedido).
    case "ticket:setWarehousePromise":
      return r === ROLES.WAREHOUSE && colMatches(resource, "Almacén");

    // Costo de envío → solo Almacén. Al guardarlo la tarjeta se mueve sola a
    // "Cotización de envío lista" (las reglas permiten ese movimiento a Almacén
    // para tickets que requieren envío).
    case "ticket:setShippingCost":
      return r === ROLES.WAREHOUSE;

    // Tipo de pago → solo Ejecutivo de Ventas (dueño). Mandatorio al crear.
    case "ticket:setPaymentType":
      return r === ROLES.SALES_EXEC && ownsTicket(user, resource);

    // Pago Confirmado → Administración o Administrador de Ventas, en la columna Administración.
    case "ticket:confirmPayment":
      return (r === ROLES.ADMINISTRATION || r === ROLES.SALES_ADMIN) &&
        colMatches(resource, "Administración");

    // # de pedido → solo el Ejecutivo dueño (o Administrador de Ventas), en "Agregar Pedido".
    case "ticket:setPedido":
      if (r === ROLES.SALES_ADMIN) return colMatches(resource, "Agregar Pedido");
      if (r === ROLES.SALES_EXEC) return ownsTicket(user, resource) && colMatches(resource, "Agregar Pedido");
      return false;

    // Aceptar/Rechazar el costo → el creador del ticket O el vendedor responsable
    // (y siempre el Administrador de Ventas).
    case "ticket:decideCost":
      if (r === ROLES.SALES_ADMIN) return true;
      if (r === ROLES.SALES_EXEC) return ownsTicket(user, resource); // creador o responsable
      return false;

    // Confirmar "Envío Pagado por el cliente" → el vendedor asignado o el Admin de Ventas.
    case "ticket:markPaid":
      if (r === ROLES.SALES_ADMIN) return true;
      if (r === ROLES.SALES_EXEC) return resource?.ownerId === user.uid;
      return false;

    case "ticket:delete":
      return false; // solo SuperAdmin (cubierto arriba)

    // ---------- Comentarios ----------
    // Todos los usuarios (activos) pueden comentar en cualquier tarjeta.
    case "comment:create":
      return true;

    // ---------- Adjuntos (se mantienen restringidos por rol) ----------
    case "attachment:add":
      if (r === ROLES.AUDITOR) return false;
      if (r === ROLES.SALES_ADMIN || r === ROLES.ADMINISTRATION) return true;
      if (r === ROLES.SALES_EXEC) return ownsTicket(user, resource);
      if (r === ROLES.PRODUCTION) return treatmentMatches(user, resource);
      // Almacén: sus tickets, y además evidencia en "Listos para recolección".
      if (r === ROLES.WAREHOUSE)
        return treatmentMatches(user, resource) || colMatches(resource, "Listos para recolección");
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
