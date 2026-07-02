// seed.js — Datos iniciales: columnas por defecto, settings y demo opcional.
// Solo lo ejecuta un SuperAdmin (las rules bloquean a cualquier otro).

import {
  fb, collection, doc, getDoc, getDocs, setDoc, addDoc, serverTimestamp, writeBatch,
} from "./firebase.js";
import { store, normalize, DEFAULT_COLUMNS, ROUTING_COLUMN_NAMES,
  TREATMENTS, SHIPPING_TYPES, DELIVERY_MODES, PRIORITIES } from "./utils.js";
import { ROLES } from "./roles.js";

// Crea columnas por defecto y settings si no existen. Idempotente.
export async function ensureSeed() {
  const user = store.currentUser;
  if (!user || user.role !== ROLES.SUPERADMIN) return;

  try {
    // Columnas por defecto
    const colsSnap = await getDocs(collection(fb.db, "columns"));
    if (colsSnap.empty) {
      const batch = writeBatch(fb.db);
      DEFAULT_COLUMNS.forEach((name, i) => {
        batch.set(doc(collection(fb.db, "columns")), {
          name,
          order: i + 1,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      console.info("[seed] Columnas por defecto creadas.");
    } else {
      // Instalaciones existentes: asegura columnas nuevas si faltan.
      const has = (name) => colsSnap.docs.some((d) => normalize(d.data().name) === normalize(name));
      const orderAfter = (name) => {
        const ref = colsSnap.docs.find((d) => normalize(d.data().name) === normalize(name));
        const maxOrder = Math.max(0, ...colsSnap.docs.map((d) => d.data().order ?? 0));
        return ref ? (ref.data().order ?? 0) + 0.5 : maxOrder + 1;
      };
      const ensureColumn = async (name, afterName) => {
        if (has(name)) return;
        await addDoc(collection(fb.db, "columns"), {
          name, order: orderAfter(afterName), active: true,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        console.info(`[seed] Columna '${name}' creada.`);
      };
      await ensureColumn(ROUTING_COLUMN_NAMES.COTIZACION_LISTA, ROUTING_COLUMN_NAMES.COTIZACION);
      await ensureColumn(ROUTING_COLUMN_NAMES.ADMINISTRACION, ROUTING_COLUMN_NAMES.COTIZACION_LISTA);
      await ensureColumn(ROUTING_COLUMN_NAMES.AGREGAR_PEDIDO, ROUTING_COLUMN_NAMES.ADMINISTRACION);
    }

    // Configuración inicial
    const settingsRef = doc(fb.db, "settings", "app");
    const settingsSnap = await getDoc(settingsRef);
    if (!settingsSnap.exists()) {
      const cfg = store.config.app;
      await setDoc(settingsRef, {
        appName: cfg.appName,
        allowedDomain: cfg.allowedDomain,
        superAdminEmails: cfg.superAdminEmails,
        createdAt: serverTimestamp(),
      });
      console.info("[seed] Configuración inicial creada.");
    }
  } catch (err) {
    console.error("[seed] Error:", err);
  }
}

// Datos demo (solo si DEMO_MODE y lo dispara el SuperAdmin desde Admin > Configuración).
export async function createDemoData() {
  const user = store.currentUser;
  if (!user || user.role !== ROLES.SUPERADMIN) throw new Error("Solo SuperAdmin.");
  if (!store.config.app.demoMode) throw new Error("demoMode está desactivado en config.js.");
  if (!store.columns.length) throw new Error("Primero deben existir columnas.");

  const used = new Set(store.tickets.map((t) => t.orderNumber));
  let created = 0;

  for (let i = 0; i < 8; i++) {
    let n;
    do { n = String(Math.floor(10000 + Math.random() * 89999)); } while (used.has(n));
    used.add(n);

    const column = store.columns[i % store.columns.length];
    const ticketRef = doc(collection(fb.db, "tickets"));
    const batch = writeBatch(fb.db);
    batch.set(doc(fb.db, "orderNumbers", n), {
      ticketId: ticketRef.id, createdBy: user.uid, createdAt: serverTimestamp(),
    });
    batch.set(ticketRef, {
      orderNumber: n,
      title: `Pedido demo ${n}`,
      treatment: TREATMENTS[i % TREATMENTS.length],
      shippingType: SHIPPING_TYPES[i % SHIPPING_TYPES.length],
      deliveryMode: DELIVERY_MODES[i % DELIVERY_MODES.length],
      addressNA: i % 3 === 0,
      shippingAddress: i % 3 === 0 ? "" : `Calle Demo ${i + 1}, Col. Centro, CDMX`,
      columnId: column.id,
      createdBy: user.uid,
      ownerId: user.uid,
      priority: i % 4 === 0 ? null : PRIORITIES[i % PRIORITIES.length],
      status: "Activo",
      commentsCount: 0,
      attachmentsCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMovedAt: serverTimestamp(),
    });
    await batch.commit();

    await addDoc(collection(fb.db, "tickets", ticketRef.id, "activity"), {
      type: "created",
      message: `${user.displayName} creó el ticket (demo).`,
      actorId: user.uid,
      metadata: {},
      createdAt: serverTimestamp(),
    });
    created++;
  }
  return created;
}

// ===================== Reinicios (solo SuperAdmin) =====================

// Borra todos los documentos de una colección en lotes. `perDoc` permite
// encolar borrados adicionales (p. ej. el /orderNumbers de cada ticket).
async function deleteAllInCollection(name, perDoc = null) {
  const snap = await getDocs(collection(fb.db, name));
  let batch = writeBatch(fb.db);
  let ops = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    ops++;
    if (perDoc) { perDoc(batch, d); ops++; }
    if (ops >= 450) { await batch.commit(); batch = writeBatch(fb.db); ops = 0; }
  }
  if (ops > 0) await batch.commit();
  return snap.size;
}

// Reinicia las gráficas del Dashboard: borra el histórico de atrasos.
export async function resetBreaches() {
  const user = store.currentUser;
  if (!user || user.role !== ROLES.SUPERADMIN) throw new Error("Solo SuperAdmin.");
  return deleteAllInCollection("slaBreaches");
}

// Reinicia TODOS los datos operativos: tickets (+ números de pedido),
// histórico de atrasos y notificaciones. Conserva usuarios, columnas y
// configuración. Nota: las subcolecciones (comentarios/adjuntos/actividad)
// y los archivos en Storage no se purgan (quedan huérfanos, ver README).
export async function resetAllData() {
  const user = store.currentUser;
  if (!user || user.role !== ROLES.SUPERADMIN) throw new Error("Solo SuperAdmin.");

  const tickets = await deleteAllInCollection("tickets", (batch, d) => {
    const on = d.data().orderNumber;
    if (on) batch.delete(doc(fb.db, "orderNumbers", String(on)));
  });
  const breaches = await deleteAllInCollection("slaBreaches");
  await deleteAllInCollection("stepTimes");
  const notifications = await deleteAllInCollection("notifications");
  return { tickets, breaches, notifications };
}
