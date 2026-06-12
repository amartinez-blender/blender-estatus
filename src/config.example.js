// ============================================================
// Blender Estatus — Configuración
// Copia este archivo como `src/config.js` y rellena tus datos.
//
// Nota: la configuración web de Firebase NO es un secreto
// (es pública en cualquier app web). La seguridad real está
// en firebase.rules y storage.rules.
// ============================================================

export const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "tu-proyecto.firebaseapp.com",
  projectId: "tu-proyecto",
  storageBucket: "tu-proyecto.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:xxxxxxxxxxxxxx",
};

export const APP_CONFIG = {
  appName: "Blender Estatus",

  // Solo correos de este dominio pueden iniciar sesión.
  allowedDomain: "blendergroup.com",

  // Correos que reciben rol SuperAdmin automáticamente al iniciar sesión.
  // IMPORTANTE: mantener sincronizado con la lista en firebase.rules.
  superAdminEmails: ["admin@blendergroup.com"],

  // Rol asignado a usuarios nuevos ("pending" = espera aprobación).
  // Si lo cambias, actualiza también firebase.rules.
  defaultRole: "pending",

  // true => el SuperAdmin puede generar datos demo desde el panel Admin.
  demoMode: false,

  // Días sin movimiento para marcar un ticket como "estancado" en el dashboard.
  staleDays: 5,
};
