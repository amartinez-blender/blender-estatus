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
      // Instalaciones existentes: asegura la columna "Cotización de envío lista".
      const exists = colsSnap.docs.some(
        (d) => normalize(d.data().name) === normalize(ROUTING_COLUMN_NAMES.COTIZACION_LISTA)
      );
      if (!exists) {
        // La colocamos justo después de "Cotización de envío" (orden fraccionario,
        // así no hay que reordenar las demás). Si no existe, va al final.
        const cotiz = colsSnap.docs.find(
          (d) => normalize(d.data().name) === normalize(ROUTING_COLUMN_NAMES.COTIZACION)
        );
        const maxOrder = Math.max(0, ...colsSnap.docs.map((d) => d.data().order ?? 0));
        const order = cotiz ? (cotiz.data().order ?? 0) + 0.5 : maxOrder + 1;
        await addDoc(collection(fb.db, "columns"), {
          name: ROUTING_COLUMN_NAMES.COTIZACION_LISTA,
          order,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        console.info("[seed] Columna 'Cotización de envío lista' creada.");
      }
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
