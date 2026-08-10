/**
 * MenuApp — Utilidades de fechas v2
 * Formato España: dd/mm/aaaa
 * Semana arranca en LUNES
 * Datepicker propio (evita dependencia del locale del navegador)
 *
 * @module Dates
 */

const Dates = (() => {

  const DIAS_ISO  = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
  const DIAS_CORTO= ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const MESES     = ['enero','febrero','marzo','abril','mayo','junio',
                     'julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const MESES_CORTO=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

  function today()    { return toISO(new Date()); }
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
   * short    → "Mar 11 ago"
   * long     → "Martes, 11 de agosto de 2026"
   * day      → "Martes"
   * dayshort → "Mar"
   * numeric  → "11/08/2026"
   * numshort → "11/08/26"
   */
  function format(isoString, fmt='short') {
    const date  = fromISO(isoString);
    const diaJS = date.getDay();                     // 0=dom
    const diaISO= diaJS===0 ? 6 : diaJS-1;          // 0=lun
    const nombre= DIAS_ISO[diaISO];
    const corto = DIAS_CORTO[diaISO];
    const num   = date.getDate();
    const numPad= String(num).padStart(2,'0');
    const mesPad= String(date.getMonth()+1).padStart(2,'0');
    const mes   = MESES[date.getMonth()];
    const mesCor= MESES_CORTO[date.getMonth()];
    const year  = date.getFullYear();
    const yearSh= String(year).slice(2);

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
    const now=new Date(); now.setHours(0,0,0,0);
    target.setHours(0,0,0,0);
    return Math.round((target-now)/(1000*60*60*24));
  }

  function range(startISO, numDays) {
    return Array.from({length:numDays},(_,i)=>addDays(startISO,i));
  }

  function dayName(isoString) {
    const d=fromISO(isoString);
    const diaJS=d.getDay();
    return DIAS_ISO[diaJS===0?6:diaJS-1];
  }

  function dayShort(isoString) {
    const d=fromISO(isoString);
    const diaJS=d.getDay();
    return DIAS_CORTO[diaJS===0?6:diaJS-1];
  }

  function expiryStatus(isoString) {
    if(!isoString) return 'none';
    const days=daysUntil(isoString);
    if(days<=0) return 'expired';
    if(days<=3) return 'urgent';
    if(days<=7) return 'soon';
    return 'ok';
  }

  function startOfWeek(isoString) {
    const d=fromISO(isoString);
    const diaJS=d.getDay();
    const diff=diaJS===0?-6:1-diaJS;
    d.setDate(d.getDate()+diff);
    return toISO(d);
  }

  // ── Datepicker propio (evita locale del navegador) ───────────────
  /**
   * Abre un datepicker modal propio, con semana empezando en lunes,
   * formato español y sin depender del navegador.
   *
   * @param {string}   currentISO  - Valor actual (YYYY-MM-DD)
   * @param {string}   [minISO]    - Fecha mínima seleccionable
   * @param {Function} onSelect    - Callback(isoString) al elegir fecha
   */
  function openDatepicker(currentISO, minISO, onSelect) {
    // Estado del datepicker
    let viewYear  = currentISO ? parseInt(currentISO.slice(0,4)) : new Date().getFullYear();
    let viewMonth = currentISO ? parseInt(currentISO.slice(5,7))-1 : new Date().getMonth();
    let selected  = currentISO || null;

    const overlay = document.createElement('div');
    overlay.className = 'dp-overlay';

    function render() {
      const todayISO = toISO(new Date());
      const firstDay = new Date(viewYear, viewMonth, 1);
      // día semana del 1 del mes (0=dom → ajustar a lunes=0)
      let startDow = firstDay.getDay();
      startDow = startDow===0 ? 6 : startDow-1;
      const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();
      // días del mes anterior para rellenar
      const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();

      let cells = '';
      // Cabecera días
      const cabDias = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
      cells += cabDias.map(d=>`<div class="dp-cell dp-head">${d}</div>`).join('');

      // Días mes anterior (relleno)
      for(let i=startDow-1;i>=0;i--) {
        cells += `<div class="dp-cell dp-other">${prevMonthDays-i}</div>`;
      }
      // Días del mes
      for(let d=1;d<=daysInMonth;d++) {
        const iso = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isToday    = iso===todayISO;
        const isSelected = iso===selected;
        const isMin      = minISO && iso<minISO;
        const cls = ['dp-cell dp-day',
          isToday    ? 'dp-today':'',
          isSelected ? 'dp-selected':'',
          isMin      ? 'dp-disabled':'',
        ].filter(Boolean).join(' ');
        cells += `<div class="${cls}" data-iso="${iso}">${d}</div>`;
      }
      // Relleno final
      const total = startDow + daysInMonth;
      const remaining = total%7===0 ? 0 : 7-(total%7);
      for(let d=1;d<=remaining;d++) {
        cells += `<div class="dp-cell dp-other">${d}</div>`;
      }

      overlay.innerHTML = `
        <div class="dp-modal">
          <div class="dp-header">
            <button class="dp-nav" id="dp-prev">‹</button>
            <span class="dp-title">${MESES[viewMonth].charAt(0).toUpperCase()+MESES[viewMonth].slice(1)} ${viewYear}</span>
            <button class="dp-nav" id="dp-next">›</button>
          </div>
          <div class="dp-grid">${cells}</div>
          <div class="dp-footer">
            <button class="btn btn-secondary btn-sm" id="dp-cancel">Cancelar</button>
            <button class="btn btn-primary btn-sm" id="dp-hoy">Hoy</button>
          </div>
        </div>`;

      // eventos
      overlay.querySelector('#dp-prev').onclick = ()=>{ viewMonth--; if(viewMonth<0){viewMonth=11;viewYear--;} render(); };
      overlay.querySelector('#dp-next').onclick = ()=>{ viewMonth++; if(viewMonth>11){viewMonth=0;viewYear++;} render(); };
      overlay.querySelector('#dp-cancel').onclick = ()=>{ overlay.remove(); };
      overlay.querySelector('#dp-hoy').onclick = ()=>{
        const now=new Date();
        viewYear=now.getFullYear(); viewMonth=now.getMonth();
        selected=toISO(now); render();
      };
      overlay.querySelectorAll('.dp-day:not(.dp-disabled)').forEach(cell=>{
        cell.onclick = ()=>{
          selected=cell.dataset.iso;
          overlay.remove();
          if(onSelect) onSelect(selected);
        };
      });
      overlay.onclick = (e)=>{ if(e.target===overlay) overlay.remove(); };
    }

    render();
    document.body.appendChild(overlay);
  }

  return {
    today, tomorrow, toISO, fromISO, format,
    addDays, daysUntil, range, dayName, dayShort,
    expiryStatus, startOfWeek, openDatepicker,
    MESES_CORTO,
  };

})();
