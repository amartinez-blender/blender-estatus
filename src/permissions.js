// permissions.js — Lógica centralizada de permisos.
// REGLA DEL PROYECTO: nadie compara user.role fuera de este archivo
// (excepción documentada: queries por rol en tickets.js).
//
// Uso: can(user, "ticket:edit", ticket)
// Estas mismas reglas están reflejadas en firebase.rules.

import { ROLES, ROLE_TREATMENT } from "./roles.js";

function ownsTicket(user, ticket) {
  return !!ticket && (ticket.ownerId === user.uid || ticket.createdBy === user.uid);
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
    case "ticket:view":
      if (r === ROLES.SALES_ADMIN || r === ROLES.AUDITOR) return true;
      if (r === ROLES.SALES_EXEC) return ownsTicket(user, resource);
      if (r === ROLES.PRODUCTION || r === ROLES.WAREHOUSE) return treatmentMatches(user, resource);
      return false;

    case "ticket:create":
      return r === ROLES.SALES_ADMIN || r === ROLES.SALES_EXEC;

    case "ticket:edit":
      if (r === ROLES.SALES_ADMIN) return true;
      if (r === ROLES.SALES_EXEC) return ownsTicket(user, resource);
      return false;

    case "ticket:move":
      if (r === ROLES.SALES_ADMIN) return true;
      if (r === ROLES.PRODUCTION || r === ROLES.WAREHOUSE) return treatmentMatches(user, resource);
      return false;

    case "ticket:assignOwner": // cambiar vendedor responsable
      return r === ROLES.SALES_ADMIN;

    case "ticket:delete":
      return false; // solo SuperAdmin (cubierto arriba)

    // ---------- Comentarios y adjuntos ----------
    // resource = ticket
    case "comment:create":
    case "attachment:add":
      if (r === ROLES.AUDITOR) return false;
      if (r === ROLES.SALES_ADMIN) return true;
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
    case "dashboard:view":
      return r === ROLES.SALES_ADMIN || r === ROLES.AUDITOR;

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
