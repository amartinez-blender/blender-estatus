// utils.js — Constantes de negocio, store global, bus de eventos y helpers.

// ===================== Catálogos =====================
export const TREATMENTS = ["Fabricación", "Almacén"];
export const SHIPPING_TYPES = ["Recolección", "Envío por cobrar", "Envío pre-pagado"];
export const DELIVERY_MODES = ["Domicilio", "Ocurre", "Recolección"];
// Modalidades válidas cuando NO es Recolección (req. 9: sin "Recolección").
export const DELIVERY_MODES_SHIPPING = ["Domicilio", "Ocurre"];
export const PAYMENT_TYPES = ["Contado", "Crédito", "Pedido Autorizado"]; // Tipo de pago (lo fija el Ejecutivo al crear)
export const PAYMENT_METHODS = ["Transferencia", "Crédito", "TDC", "TDD", "Nota de Crédito", "Efectivo"]; // Forma de pago (la fija Administración al confirmar)

// Tipos de envío que envían el ticket a la columna de cotización.
export const QUOTE_SHIPPING_TYPES = ["Envío por cobrar", "Envío pre-pagado"];

// Nombres de columnas usados por el routing automático al crear un ticket.
export const ROUTING_COLUMN_NAMES = {
  FABRICACION: "Fabricación",
  ALMACEN: "Almacén",
  COTIZACION: "Cotización de envío",
  COTIZACION_LISTA: "Cotización de envío lista",
  ADMINISTRACION: "Administración",
  AGREGAR_PEDIDO: "Agregar Pedido",
};

// Formatea un monto a moneda mexicana: "$1,234.50 MXN".
export function fmtMoney(value) {
  const n = Number(value);
  if (!isFinite(n)) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency", currency: "MXN", minimumFractionDigits: 2,
  }).format(n) + " MXN";
}
export const PRIORITIES = ["Baja", "Media", "Alta", "Urgente"];
export const TICKET_STATUSES = ["Activo", "Cerrado", "Cancelado"];
export const DEFAULT_COLUMNS = [
  "Nuevo",
  "Cotización de envío",
  "Cotización de envío lista",
  "Administración",
  "Agregar Pedido",
  "Fabricación",
  "Almacén",
  "Listos para recolección",
];

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const MAX_ADDRESS_LENGTH = 500;
export const ORDER_NUMBER_RE = /^\d{1,5}$/;

// ===================== Store global =====================
// Único estado compartido de la app. Los módulos lo leen y emiten
// eventos cuando cambia; nadie más guarda estado global.
export const store = {
  config: null,        // { firebase, app }
  authUser: null,      // usuario de Firebase Auth
  currentUser: null,   // doc de /users/{uid}
  users: [],
  columns: [],
  tickets: [],
  notifications: [],
  vendorFilter: [],    // uids de vendedores seleccionados; [] = todos
  settings: null,      // doc /settings/app (incluye SLA de Producción/Almacén)
  unsubs: {},          // funciones unsubscribe de listeners activos
};

// Normaliza texto para comparaciones tolerantes a acentos/mayúsculas.
export function normalize(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

// ===================== Bus de eventos =====================
const bus = new EventTarget();
export function emit(name, detail = null) {
  bus.dispatchEvent(new CustomEvent(name, { detail }));
}
export function on(name, handler) {
  const fn = (e) => handler(e.detail);
  bus.addEventListener(name, fn);
  return () => bus.removeEventListener(name, fn);
}

// ===================== DOM =====================
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ===================== Fechas =====================
export function toDate(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts.toDate === "function") return ts.toDate(); // Firestore Timestamp
  return new Date(ts);
}

export function fmtDateTime(ts) {
  const d = toDate(ts);
  if (!d) return "—";
  return d.toLocaleString("es-MX", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function relativeTime(ts) {
  const d = toDate(ts);
  if (!d) return "—";
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `hace ${days} d`;
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

export function daysSince(ts) {
  const d = toDate(ts);
  if (!d) return 0;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// Formatea una cuenta regresiva en ms a texto corto: "2d 3h", "5h 12m", "8m".
export function fmtCountdown(ms) {
  if (ms <= 0) return "Vencido";
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Convierte horas+minutos a milisegundos.
export function durationToMs(d) {
  return ((d?.hours || 0) * 60 + (d?.minutes || 0)) * 60000;
}

// Número principal de la tarjeta: el # de pedido si ya existe, si no el de cotización.
// (orderNumber = # de cotización; pedidoNumber = # de pedido, se asigna al aceptar costo)
export function mainOrderNumber(t) {
  return (t && t.pedidoNumber) ? t.pedidoNumber : t?.orderNumber;
}

// Etiqueta principal: "Pedido: X" si ya hay # de pedido, si no "Cotización: X".
// Incluye el nombre del cliente cuando existe (visible en tarjeta, detalle y notificaciones).
export function orderRef(t) {
  const base = (t && t.pedidoNumber) ? `Pedido: ${t.pedidoNumber}` : `Cotización: ${t?.orderNumber}`;
  return t?.client ? `${base} · ${t.client}` : base;
}

// ===================== Varios =====================
export function initials(name) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");
}

export function fmtFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ===================== Validaciones =====================
export function validateOrderNumber(value) {
  return ORDER_NUMBER_RE.test(String(value || ""));
}

// Valida los campos de un ticket (sin unicidad, que requiere Firestore).
// Devuelve un array de mensajes de error; vacío = válido.
export function validateTicketData(data) {
  const errors = [];
  if (!data.orderNumber) errors.push("El número de cotización es obligatorio.");
  else if (!validateOrderNumber(data.orderNumber))
    errors.push("El número de cotización debe ser solo numérico, máximo 5 dígitos.");
  if (!data.client || !String(data.client).trim()) errors.push("El nombre del cliente es obligatorio.");
  else if (String(data.client).trim().length > 200) errors.push("El nombre del cliente no puede exceder 200 caracteres.");
  if (!TREATMENTS.includes(data.treatment)) errors.push("Selecciona el tratamiento del pedido.");
  if (!SHIPPING_TYPES.includes(data.shippingType)) errors.push("Selecciona el tipo de envío.");
  if (!DELIVERY_MODES.includes(data.deliveryMode)) errors.push("Selecciona la modalidad de entrega.");
  if (!data.addressNA) {
    if (!data.shippingAddress || !data.shippingAddress.trim())
      errors.push("La dirección de envío es obligatoria (o marca N/A).");
    else if (data.shippingAddress.length > MAX_ADDRESS_LENGTH)
      errors.push(`La dirección no puede exceder ${MAX_ADDRESS_LENGTH} caracteres.`);
  }
  if (data.priority && !PRIORITIES.includes(data.priority)) errors.push("Prioridad inválida.");
  if (!PAYMENT_TYPES.includes(data.tipoPago)) errors.push("Selecciona el tipo de pago.");
  if (!data.columnId) errors.push("Selecciona una columna.");
  return errors;
}

export function validateFile(file) {
  const errors = [];
  if (!ALLOWED_FILE_TYPES.includes(file.type))
    errors.push("Tipo de archivo no permitido. Usa JPG, PNG, WEBP o PDF.");
  if (file.size > MAX_FILE_SIZE) errors.push("El archivo excede el máximo de 10 MB.");
  return errors;
}
