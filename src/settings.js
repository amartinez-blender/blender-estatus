// settings.js — Configuración global de la app (/settings/app), incluye los
// tiempos de SLA que el SuperAdmin define para Producción y Almacén.

import { fb, doc, onSnapshot, setDoc, serverTimestamp } from "./firebase.js";
import { store, emit } from "./utils.js";

// Valores por defecto si el SuperAdmin aún no configura los SLA.
export const DEFAULT_SLA = {
  quote: { hours: 4, minutes: 0 },       // tiempo para asignar "Costo de envío"
  admin: { hours: 4, minutes: 0 },       // tiempo para "Pago Confirmado" (Administración)
  production: { hours: 24, minutes: 0 }, // tiempo para asignar "Fecha y Hora en Almacén"
  warehouse: { hours: 24, minutes: 0 },  // tiempo para asignar "Fecha y Hora para Listo"
};

export function listenSettings() {
  store.unsubs.settings?.();
  store.unsubs.settings = onSnapshot(
    doc(fb.db, "settings", "app"),
    (snap) => {
      store.settings = snap.exists() ? snap.data() : {};
      emit("settings:changed", store.settings);
    },
    (err) => console.error("[settings] listener:", err)
  );
}

// Devuelve los SLA efectivos (con defaults si faltan).
export function getSla() {
  const s = store.settings || {};
  return {
    quote: s.slaQuote || DEFAULT_SLA.quote,
    admin: s.slaAdmin || DEFAULT_SLA.admin,
    production: s.slaProduction || DEFAULT_SLA.production,
    warehouse: s.slaWarehouse || DEFAULT_SLA.warehouse,
  };
}

const hm = (d) => ({ hours: Number(d.hours) || 0, minutes: Number(d.minutes) || 0 });

// Solo SuperAdmin (reforzado en firebase.rules).
export async function saveSlaSettings({ quote, admin, production, warehouse }) {
  await setDoc(
    doc(fb.db, "settings", "app"),
    {
      slaQuote: hm(quote),
      slaAdmin: hm(admin),
      slaProduction: hm(production),
      slaWarehouse: hm(warehouse),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
