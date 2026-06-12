// auth.js — Login con Google, restricción de dominio y ciclo de vida del usuario.

import {
  fb, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp,
} from "./firebase.js";
import { store, emit } from "./utils.js";
import { ROLES } from "./roles.js";

export const ACCESS_DENIED_MESSAGE = "Acceso restringido a usuarios de Blender Group.";

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
    if (domain.toLowerCase() !== appCfg.allowedDomain.toLowerCase()) {
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
  provider.setCustomParameters({
    prompt: "select_account",
    hd: store.config.app.allowedDomain, // sugiere el dominio en el selector de Google
  });
  await signInWithPopup(fb.auth, provider);
}

export async function logout() {
  // Detener todos los listeners antes de cerrar sesión para evitar errores de permisos.
  Object.values(store.unsubs).forEach((unsub) => unsub?.());
  store.unsubs = {};
  await signOut(fb.auth);
}
