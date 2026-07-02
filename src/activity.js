// activity.js — Historial de actividad por ticket y actividad reciente global.

import {
  fb, collection, collectionGroup, addDoc, query, orderBy, limit, onSnapshot,
  getDocs, serverTimestamp,
} from "./firebase.js";
import { store } from "./utils.js";

// Tipos de actividad usados en la app:
// created | moved | updated | owner_changed | status_changed |
// comment_added | comment_deleted | attachment_added | attachment_deleted

export async function logActivity(ticketId, type, message, metadata = {}) {
  try {
    await addDoc(collection(fb.db, "tickets", ticketId, "activity"), {
      type,
      message,
      actorId: store.currentUser?.uid || null,
      metadata,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // La actividad no debe romper la operación principal.
    console.error("[activity] No se pudo registrar:", err);
  }
}

export function listenTicketActivity(ticketId, callback) {
  const q = query(
    collection(fb.db, "tickets", ticketId, "activity"),
    orderBy("createdAt", "desc"),
    limit(50)
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => console.error("[activity] listener:", err)
  );
}

// Actividad reciente global (dashboard). Requiere el índice collection-group
// sobre `createdAt` — la consola de Firebase da el enlace si falta (ver README).
export async function fetchRecentActivity(max = 25) {
  const q = query(collectionGroup(fb.db, "activity"), orderBy("createdAt", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id,
    ticketId: d.ref.parent.parent.id,
    ...d.data(),
  }));
}

// Incidencias de atraso para la analítica histórica del Dashboard (req. 4).
export async function fetchSlaBreaches(max = 2000) {
  const q = query(collection(fb.db, "slaBreaches"), orderBy("createdAt", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Tiempos por etapa para los promedios del Dashboard.
export async function fetchStepTimes(max = 3000) {
  const q = query(collection(fb.db, "stepTimes"), orderBy("createdAt", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
