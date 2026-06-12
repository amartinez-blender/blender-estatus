// ============================================================
// Blender Estatus — Configuración
// Copia este archivo como `src/config.js` y rellena tus datos.
//
// Nota: la configuración web de Firebase NO es un secreto
// (es pública en cualquier app web). La seguridad real está
// en firebase.rules y storage.rules.
// ============================================================

export const firebaseConfig = {
 apiKey: "AIzaSyA8cH2MPuSXl_y8WLlgl2QH-XRlU-hrNjs",
  authDomain: "blender-estatus.firebaseapp.com",
  projectId: "blender-estatus",
  storageBucket: "blender-estatus.firebasestorage.app",
  messagingSenderId: "172347888961",
  appId: "1:172347888961:web:b0378d49d9efaad332fdc0",
  measurementId: "G-XYS8YYNQNC"
};

export const APP_CONFIG = {
  appName: "Blender Estatus",

  // Solo correos de este dominio pueden iniciar sesión.
  allowedDomain: "blendergroup.com",

  // Correos que reciben rol SuperAdmin automáticamente al iniciar sesión.
  // IMPORTANTE: mantener sincronizado con la lista en firebase.rules.
  superAdminEmails: ["amartinez@blendergroup.com"],

  // Rol asignado a usuarios nuevos ("pending" = espera aprobación).
  // Si lo cambias, actualiza también firebase.rules.
  defaultRole: "pending",

  // true => el SuperAdmin puede generar datos demo desde el panel Admin.
  demoMode: false,

  // Días sin movimiento para marcar un ticket como "estancado" en el dashboard.
  staleDays: 5,
};
