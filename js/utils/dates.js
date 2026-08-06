/**
 * MenuApp — Utilidades de fechas
 * Funciones de formateo y cálculo de fechas usadas en toda la app.
 *
 * @module Dates
 */

const Dates = (() => {

  const DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const MESES = ['enero','febrero','marzo','abril','mayo','junio',
                 'julio','agosto','septiembre','octubre','noviembre','diciembre'];

  /**
   * Devuelve la fecha de hoy en formato ISO (YYYY-MM-DD), sin hora.
   * @returns {string}
   */
  function today() {
    return toISO(new Date());
  }

  /**
   * Devuelve la fecha de mañana en formato ISO.
   * @returns {string}
   */
  function tomorrow() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return toISO(d);
  }

  /**
   * Convierte un objeto Date a string ISO (YYYY-MM-DD).
   * @param {Date} date
   * @returns {string}
   */
  function toISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Parsea una fecha ISO a objeto Date (interpreta como hora local, no UTC).
   * @param {string} isoString - 'YYYY-MM-DD'
   * @returns {Date}
   */
  function fromISO(isoString) {
    const [y, m, d] = isoString.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  /**
   * Formatea una fecha ISO para mostrar al usuario.
   * @param {string} isoString
   * @param {'short'|'long'|'day'} [format='short']
   * @returns {string} Ej: 'lun 7 jul' / 'lunes, 7 de julio de 2025' / 'Lunes'
   */
  function format(isoString, format = 'short') {
    const date = fromISO(isoString);
    const dia  = DIAS[date.getDay()];
    const mes  = MESES[date.getMonth()];
    const num  = date.getDate();
    const year = date.getFullYear();

    switch (format) {
      case 'long': return `${dia}, ${num} de ${mes} de ${year}`;
      case 'day':  return dia;
      case 'dayshort': return dia.substring(0, 3);
      default: return `${dia.substring(0, 3).toLowerCase()} ${num} ${mes.substring(0, 3)}`;
    }
  }

  /**
   * Añade N días a una fecha ISO y devuelve la nueva fecha ISO.
   * @param {string} isoString
   * @param {number} days
   * @returns {string}
   */
  function addDays(isoString, days) {
    const date = fromISO(isoString);
    date.setDate(date.getDate() + days);
    return toISO(date);
  }

  /**
   * Calcula los días que faltan hasta una fecha ISO desde hoy.
   * Devuelve un número negativo si la fecha ya pasó.
   * @param {string} isoString
   * @returns {number}
   */
  function daysUntil(isoString) {
    const target = fromISO(isoString);
    const now    = new Date();
    now.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    return Math.round((target - now) / (1000 * 60 * 60 * 24));
  }

  /**
   * Genera un array de fechas ISO para un rango dado.
   * @param {string} startISO - Fecha de inicio (incluida)
   * @param {number} numDays  - Número de días
   * @returns {string[]}
   */
  function range(startISO, numDays) {
    return Array.from({ length: numDays }, (_, i) => addDays(startISO, i));
  }

  /**
   * Devuelve el nombre del día de la semana de una fecha ISO.
   * @param {string} isoString
   * @returns {string} Ej: 'Lunes'
   */
  function dayName(isoString) {
    return DIAS[fromISO(isoString).getDay()];
  }

  /**
   * Clasifica la urgencia de una fecha de caducidad.
   * @param {string|null} isoString
   * @returns {'expired'|'urgent'|'soon'|'ok'|'none'}
   */
  function expiryStatus(isoString) {
    if (!isoString) return 'none';
    const days = daysUntil(isoString);
    if (days < 0)  return 'expired';
    if (days === 0) return 'expired';
    if (days <= 3)  return 'urgent';
    if (days <= 7)  return 'soon';
    return 'ok';
  }

  return { today, tomorrow, toISO, fromISO, format, addDays, daysUntil, range, dayName, expiryStatus };

})();
