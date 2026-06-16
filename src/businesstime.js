// businesstime.js — Tiempo hábil para todos los timers/SLA.
// Reglas: Lunes a Viernes, de 08:00 a 18:00, hora local (México),
// excluyendo los días festivos oficiales (Art. 74 LFT).
//
// El reloj de SLA SOLO avanza dentro de ese horario: noches, fines de
// semana y festivos no cuentan.

export const WORK_START_HOUR = 8;   // 08:00
export const WORK_END_HOUR = 18;    // 18:00
export const BUSINESS_MS_PER_DAY = (WORK_END_HOUR - WORK_START_HOUR) * 3600 * 1000;

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// N-ésimo día de la semana de un mes. weekday: 0=Dom … 1=Lun … 6=Sáb.
function nthWeekday(year, month1, weekday, n) {
  let count = 0;
  for (let day = 1; day <= 31; day++) {
    const d = new Date(year, month1 - 1, day);
    if (d.getMonth() !== month1 - 1) break;
    if (d.getDay() === weekday) {
      count++;
      if (count === n) return iso(d);
    }
  }
  return null;
}

const holidayCache = {};

// Festivos oficiales de México (Art. 74 LFT) para un año dado.
export function mexicanHolidays(year) {
  if (holidayCache[year]) return holidayCache[year];
  const set = new Set([
    `${year}-01-01`,                 // Año Nuevo
    nthWeekday(year, 2, 1, 1),        // 1er lunes de febrero (Constitución)
    nthWeekday(year, 3, 1, 3),        // 3er lunes de marzo (Benito Juárez)
    `${year}-05-01`,                 // Día del Trabajo
    `${year}-09-16`,                 // Independencia
    nthWeekday(year, 11, 1, 3),       // 3er lunes de noviembre (Revolución)
    `${year}-12-25`,                 // Navidad
  ]);
  // Transmisión del Poder Ejecutivo Federal: 1 de octubre cada 6 años (2024, 2030…).
  if ((year - 2024) % 6 === 0) set.add(`${year}-10-01`);
  holidayCache[year] = set;
  return set;
}

export function isHoliday(date) {
  return mexicanHolidays(date.getFullYear()).has(iso(date));
}

export function isBusinessDay(date) {
  const day = date.getDay();
  return day >= 1 && day <= 5 && !isHoliday(date);
}

function startOfWork(date) {
  const d = new Date(date);
  d.setHours(WORK_START_HOUR, 0, 0, 0);
  return d;
}
function endOfWork(date) {
  const d = new Date(date);
  d.setHours(WORK_END_HOUR, 0, 0, 0);
  return d;
}

// Primer instante hábil >= instant (si ya está dentro, devuelve el mismo).
export function nextBusinessStart(instant) {
  let cur = new Date(instant);
  for (let guard = 0; guard < 4000; guard++) {
    if (isBusinessDay(cur)) {
      const s = startOfWork(cur);
      const e = endOfWork(cur);
      if (cur < s) return s;
      if (cur < e) return cur;
      // cur >= cierre → siguiente día
    }
    cur = new Date(cur);
    cur.setDate(cur.getDate() + 1);
    cur.setHours(0, 0, 0, 0);
  }
  return cur;
}

// Suma `ms` de tiempo hábil a `start` y devuelve el instante real resultante.
export function addBusinessMs(start, ms) {
  let cur = nextBusinessStart(new Date(start));
  let rem = Math.max(0, ms);
  for (let guard = 0; guard < 4000 && rem > 0; guard++) {
    const e = endOfWork(cur);
    const avail = e - cur;
    if (rem <= avail) return new Date(cur.getTime() + rem);
    rem -= avail;
    const n = new Date(cur);
    n.setDate(n.getDate() + 1);
    n.setHours(0, 0, 0, 0);
    cur = nextBusinessStart(n);
  }
  return cur;
}

// Milisegundos hábiles transcurridos entre a y b (0 si a >= b).
export function businessMsBetween(a, b) {
  const start = new Date(a);
  const end = new Date(b);
  if (start >= end) return 0;
  let total = 0;
  let cur = nextBusinessStart(start);
  for (let guard = 0; guard < 4000 && cur < end; guard++) {
    const e = endOfWork(cur);
    const segEnd = e < end ? e : end;
    if (segEnd > cur) total += segEnd - cur;
    const n = new Date(cur);
    n.setDate(n.getDate() + 1);
    n.setHours(0, 0, 0, 0);
    cur = nextBusinessStart(n);
  }
  return total;
}
