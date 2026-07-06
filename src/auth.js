// auth.js — Login con Google, restricción de dominio y ciclo de vida del usuario.

import {
  fb, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp,
} from "./firebase.js";
import { store, emit } from "./utils.js";
import { ROLES } from "./roles.js";

export const ACCESS_DENIED_MESSAGE = "Acceso restringido a usuarios de Blender (blendergroup.com o blendershop.com).";

// Lista de dominios permitidos (en minúsculas). Soporta `allowedDomains` (array)
// y hace fallback a `allowedDomain` (string) por compatibilidad.
export function allowedDomains(appCfg = store.config?.app || {}) {
  const list = Array.isArray(appCfg.allowedDomains) && appCfg.allowedDomains.length
    ? appCfg.allowedDomains
    : (appCfg.allowedDomain ? [appCfg.allowedDomain] : []);
  return list.map((d) => String(d).toLowerCase());
}

// callbacks: { onSignedOut, onDomainRejected, onUserReady, onError }
export function initAuth(callbacks) {
  onAuthStateChanged(fb.auth, async (authUser) => {
    if (!authUser) {
      stopUserListener();
      store.authUser = null;
      store.currentUser = null;
      callbacks.onSignedOut();
      return;
    }

    const appCfg = store.config.app;
    const domain = (authUser.email || "").split("@")[1] || "";
    if (!allowedDomains(appCfg).includes(domain.toLowerCase())) {
      await signOut(fb.auth);
      callbacks.onDomainRejected(ACCESS_DENIED_MESSAGE);
      return;
    }

    store.authUser = authUser;
    try {
      await ensureUserDoc(authUser, appCfg);
      listenToOwnUser(authUser.uid, callbacks);
    } catch (err) {
      console.error("[auth] Error preparando usuario:", err);
      callbacks.onError(err);
    }
  });
}

// Crea /users/{uid} en el primer login; actualiza datos básicos en cada login.
async function ensureUserDoc(authUser, appCfg) {
  const ref = doc(fb.db, "users", authUser.uid);
  const snap = await getDoc(ref);
  const isSuperAdmin = appCfg.superAdminEmails
    .map((e) => e.toLowerCase())
    .includes((authUser.email || "").toLowerCase());

  if (!snap.exists()) {
    await setDoc(ref, {
      uid: authUser.uid,
      displayName: authUser.displayName || authUser.email,
      email: authUser.email,
      photoURL: authUser.photoURL || "",
      phone: "", // Google no siempre entrega teléfono: se captura en el perfil.
      role: isSuperAdmin ? ROLES.SUPERADMIN : appCfg.defaultRole,
      active: true,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    });
  } else {
    const updates = {
      lastLoginAt: serverTimestamp(),
      displayName: authUser.displayName || snap.data().displayName,
      photoURL: authUser.photoURL || snap.data().photoURL || "",
    };
    // Promoción automática si el correo fue añadido a la lista de SuperAdmins.
    if (isSuperAdmin && snap.data().role !== ROLES.SUPERADMIN) {
      updates.role = ROLES.SUPERADMIN;
    }
    await updateDoc(ref, updates);
  }
}

// Escucha el propio doc de usuario: detecta en vivo cambios de rol o bloqueo.
function listenToOwnUser(uid, callbacks) {
  stopUserListener();
  store.unsubs.me = onSnapshot(
    doc(fb.db, "users", uid),
    (snap) => {
      if (!snap.exists()) return;
      store.currentUser = { id: snap.id, ...snap.data() };
      emit("user:changed", store.currentUser);
      callbacks.onUserReady(store.currentUser);
    },
    (err) => callbacks.onError(err)
  );
}

function stopUserListener() {
  store.unsubs.me?.();
  delete store.unsubs.me;
}

export async function login() {
  const provider = new GoogleAuthProvider();
  const params = { prompt: "select_account" };
  // El parámetro `hd` restringe el selector a UN solo dominio; solo lo usamos si
  // hay exactamente uno permitido. Con varios, lo omitimos para no bloquearlos.
  const domains = allowedDomains();
  if (domains.length === 1) params.hd = domains[0];
  provider.setCustomParameters(params);
  await signInWithPopup(fb.auth, provider);
}

export async function logout() {
  // Detener todos los listeners antes de cerrar sesión para evitar errores de permisos.
  // Algunos listeners se guardan como arrays (p. ej. tickets), otros como función.
  Object.values(store.unsubs).forEach((u) => {
    if (Array.isArray(u)) u.forEach((fn) => { try { fn?.(); } catch {} });
    else { try { u?.(); } catch {} }
  });
  store.unsubs = {};
  await signOut(fb.auth);
}
