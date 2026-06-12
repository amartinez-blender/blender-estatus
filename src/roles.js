// roles.js — Constantes de roles. Única fuente de verdad de roles en el frontend.
// Si cambias algo aquí, actualiza también firebase.rules.

export const ROLES = {
  SUPERADMIN: "superadmin",
  SALES_ADMIN: "sales_admin",
  SALES_EXEC: "sales_exec",
  PRODUCTION: "production",
  WAREHOUSE: "warehouse",
  AUDITOR: "auditor",
  PENDING: "pending",
};

export const ROLE_LABELS = {
  [ROLES.SUPERADMIN]: "SuperAdmin",
  [ROLES.SALES_ADMIN]: "Administrador de Ventas",
  [ROLES.SALES_EXEC]: "Ejecutivo de Ventas",
  [ROLES.PRODUCTION]: "Producción",
  [ROLES.WAREHOUSE]: "Almacén",
  [ROLES.AUDITOR]: "Auditor",
  [ROLES.PENDING]: "Pendiente de aprobación",
};

// Roles que el SuperAdmin puede asignar desde el panel Admin.
export const ASSIGNABLE_ROLES = [
  ROLES.SUPERADMIN,
  ROLES.SALES_ADMIN,
  ROLES.SALES_EXEC,
  ROLES.PRODUCTION,
  ROLES.WAREHOUSE,
  ROLES.AUDITOR,
  ROLES.PENDING,
];

// Tratamiento de pedido al que está restringido cada rol operativo.
export const ROLE_TREATMENT = {
  [ROLES.PRODUCTION]: "Fabricación",
  [ROLES.WAREHOUSE]: "Almacén",
};

export function isValidRole(role) {
  return Object.values(ROLES).includes(role);
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || role || "—";
}
