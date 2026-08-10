/**
 * MenuApp — Utilidades de fechas
 * Formato España: dd/mm/aaaa
 * Semana arranca en LUNES (ISO 8601)
 *
 * @module Dates
 */

const Dates = (() => {

  const DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const DIAS_ISO = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']; // lunes=0
  const DIAS_CORTO = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const MESES = ['enero','febrero','marzo','abril','mayo','junio',
                 'julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const MESES_CORTO = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

  function today() { return toISO(new Date()); }
  function tomorrow() { const d=new Date(); d.setDate(d.getDate()+1); return toISO(d); }

  function toISO(date) {
    const y=date.getFullYear();
    const m=String(date.getMonth()+1).padStart(2,'0');
    const d=String(date.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }

  function fromISO(isoString) {
    const [y,m,d]=isoString.split('-').map(Number);
    return new Date(y,m-1,d);
  }

  /**
   * Formatea fecha ISO para mostrar al usuario en formato español.
   * @param {string} isoString
   * @param {'short'|'long'|'day'|'dayshort'|'numeric'} [fmt='short']
   * short   → "lun 7 ene"
   * long    → "lunes, 7 de enero de 2025"
   * day     → "Lunes"
   * dayshort→ "Lun"
   * numeric → "07/01/2025"
   * numshort→ "07/01/25"
   */
  function format(isoString, fmt='short') {
    const date = fromISO(isoString);
    const diaJS  = date.getDay();                        // 0=dom
    const diaISO = diaJS === 0 ? 6 : diaJS - 1;         // 0=lun
    const nombre = DIAS_ISO[diaISO];
    const corto  = DIAS_CORTO[diaISO];
    const num    = date.getDate();
    const numPad = String(num).padStart(2,'0');
    const mes    = MESES[date.getMonth()];
    const mesCor = MESES_CORTO[date.getMonth()];
    const mesPad = String(date.getMonth()+1).padStart(2,'0');
    const year   = date.getFullYear();
    const yearSh = String(year).slice(2);

    switch(fmt) {
      case 'long':     return `${nombre}, ${num} de ${mes} de ${year}`;
      case 'day':      return nombre;
      case 'dayshort': return corto;
      case 'numeric':  return `${numPad}/${mesPad}/${year}`;
      case 'numshort': return `${numPad}/${mesPad}/${yearSh}`;
      default:         return `${corto} ${num} ${mesCor}`;
    }
  }

  function addDays(isoString, days) {
    const d=fromISO(isoString);
    d.setDate(d.getDate()+days);
    return toISO(d);
  }

  function daysUntil(isoString) {
    const target=fromISO(isoString);
    const now=new Date();
    now.setHours(0,0,0,0);
    target.setHours(0,0,0,0);
    return Math.round((target-now)/(1000*60*60*24));
  }

  function range(startISO, numDays) {
    return Array.from({length:numDays},(_,i)=>addDays(startISO,i));
  }

  /** Nombre del día (lunes=primero) */
  function dayName(isoString) {
    const d=fromISO(isoString);
    const diaJS=d.getDay();
    return DIAS_ISO[diaJS===0?6:diaJS-1];
  }

  /** Nombre corto del día */
  function dayShort(isoString) {
    const d=fromISO(isoString);
    const diaJS=d.getDay();
    return DIAS_CORTO[diaJS===0?6:diaJS-1];
  }

  function expiryStatus(isoString) {
    if(!isoString) return 'none';
    const days=daysUntil(isoString);
    if(days<0||days===0) return 'expired';
    if(days<=3)  return 'urgent';
    if(days<=7)  return 'soon';
    return 'ok';
  }

  /**
   * Primer lunes de la semana que contiene la fecha dada.
   */
  function startOfWeek(isoString) {
    const d=fromISO(isoString);
    const diaJS=d.getDay(); // 0=dom
    const diff = diaJS===0 ? -6 : 1-diaJS; // días hasta el lunes
    d.setDate(d.getDate()+diff);
    return toISO(d);
  }

  return { today, tomorrow, toISO, fromISO, format, addDays, daysUntil, range, dayName, dayShort, expiryStatus, startOfWeek };

})();
