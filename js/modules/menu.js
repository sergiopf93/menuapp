/**
 * MenuApp — Módulo de Menú v3
 *
 * Fixes:
 * - Calendario con cabeceras alineadas (flex en lugar de table)
 * - Datepicker propio (lunes primero, formato español)
 * - Días especiales: lógica por perfil correcta
 * - Priorización: forzar uso solo si no ya consumido; caducidad solo dentro del horizonte
 * - Vista calendario disponible en dashboard
 *
 * @module Menu
 */

const Menu = (() => {

  let _paso = 0;
  let _menuEnCurso = null;

  // ── Reglas alimenticias (OMS / guía nutricional) ─────────────────
  // Seguimiento semanal por grupo alimenticio
  const GRUPOS_NUTRICIONALES = {
    'legumbre':     { min: 3, max: 4,  etiquetas: ['legumbre'] },
    'pescado':      { min: 3, max: 4,  etiquetas: ['pescado-blanco','pescado-azul'] },
    'pescado-azul': { min: 1, max: 2,  etiquetas: ['pescado-azul'] },
    'carne':        { min: 2, max: 3,  etiquetas: ['carne-ave','carne-roja'] },
    'carne-roja':   { min: 0, max: 1,  etiquetas: ['carne-roja'] },
    'huevo':        { min: 3, max: 4,  etiquetas: ['huevo'] },
    'verdura':      { min: 7, max: 99, etiquetas: ['verdura','ensalada'] },
    'hidratos':     { min: 3, max: 7,  etiquetas: ['hidratos'] },
  };

  // Detección de proteína/grupo por etiqueta (usa las etiquetas del sistema)
  const ETIQUETAS_PROTEINA = {
    carne:    ['carne-ave','carne-roja'],
    pescado:  ['pescado-blanco','pescado-azul'],
    legumbre: ['legumbre'],
    huevo:    ['huevo'],
    hidratos: ['hidratos'],
  };

  // ── API pública ──────────────────────────────────────────────────

  function render() {
    _ensureView();
    _paso = 0;
    _renderVista();
  }

  /** Devuelve el HTML del calendario para usarlo en el dashboard.
   *  Usa el menuActual del estado si está disponible para evitar llamadas a Drive. */
  async function getCalendarioHTML() {
    const state = App.getState();
    let todosMenus = [];

    // Intenta usar el menú ya cargado en el estado
    if (state.menuActual) {
      todosMenus = [state.menuActual];
    } else {
      // Va a Drive con timeout de 5s para no colgar el dashboard
      try {
        const timeoutPromise = new Promise((_,rej) => setTimeout(()=>rej(new Error('timeout')),5000));
        const drivePromise = Drive.listMenuFiles().catch(()=>[]);
        const menusEnDrive = await Promise.race([drivePromise, timeoutPromise]).catch(()=>[]);
        for (const f of menusEnDrive.slice(0,3)) {  // máximo 3 para no tardar
          try { const m=await Drive.readMenuJson(f.id); if(m) todosMenus.push(m); } catch{}
        }
      } catch { todosMenus = []; }
    }

    const diasCombinados = _combinarDiasDeMenus(todosMenus);
    if (!diasCombinados.length) return null;
    const config = state.config||{};
    const tieneBebe = (config.personas||[]).some(p=>p.tipo==='bebe');
    return _buildCalendario(diasCombinados, tieneBebe);
  }

  // ── Vista principal ──────────────────────────────────────────────

  async function _renderVista() {
    const view = document.getElementById('view-menu');
    if (!view) return;
    view.innerHTML = `<div class="loading-container" style="padding:var(--space-8) 0">
      <div class="loading-spinner"></div><p class="loading-message">Cargando menús...</p></div>`;

    const hoy = Dates.today();
    const menusEnDrive = await Drive.listMenuFiles().catch(()=>[]);
    const todosMenus = [];
    for (const f of menusEnDrive) {
      try { const m=await Drive.readMenuJson(f.id); if(m) todosMenus.push(m); } catch{}
    }
    const menuActivo = todosMenus.find(m => m.fechaInicio<=hoy&&m.fechaFin>=hoy&&m.estado!=='historico');
    const diasCombinados = _combinarDiasDeMenus(todosMenus);
    const config = App.getState().config||{};
    const tieneBebe = (config.personas||[]).some(p=>p.tipo==='bebe');
    App.getState().menuActual = menuActivo||null;

    view.innerHTML = `
      <div class="module-header">
        <h1 class="module-title">Menú</h1>
        <button class="btn btn-primary btn-sm" id="menu-btn-nuevo">+ Nuevo</button>
      </div>
      ${diasCombinados.length>0
        ? `<div class="menu-calendario-wrapper">${_buildCalendario(diasCombinados,tieneBebe)}</div>
           <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4)">
             ${menuActivo
               ? `<button class="btn btn-secondary" style="flex:1" id="menu-btn-editar">✏️ Editar semana</button>
                  <button class="btn btn-primary" style="flex:1" id="menu-btn-compra">🛒 Compra</button>`
               : `<button class="btn btn-primary btn-full" id="menu-btn-nuevo2">Generar menú de esta semana</button>`}
           </div>
           <div style="margin-top:var(--space-3)">
             <button class="btn btn-secondary btn-full" id="menu-btn-kpi">📊 Ver equilibrio nutricional</button>
           </div>`
        : `<div class="card card-empty">
             <div class="empty-state-icon">📅</div>
             <p>No hay menú generado todavía.</p>
             <button class="btn btn-primary" id="menu-btn-nuevo2">Generar primer menú</button>
           </div>`}`;

    document.getElementById('menu-btn-kpi')?.addEventListener('click', ()=>_mostrarKPIs(diasCombinados));
    document.getElementById('menu-btn-nuevo')?.addEventListener('click',_iniciarAsistente);
    document.getElementById('menu-btn-nuevo2')?.addEventListener('click',_iniciarAsistente);
    document.getElementById('menu-btn-editar')?.addEventListener('click',()=>{
      if(menuActivo){ _menuEnCurso=JSON.parse(JSON.stringify(menuActivo)); _paso=5; _renderAsistente(); }
    });
    document.getElementById('menu-btn-compra')?.addEventListener('click',()=>App.navigate('compra'));
  }

  // ── Combinar días ────────────────────────────────────────────────

  function _combinarDiasDeMenus(menus) {
    const porFecha={};
    menus.forEach(m=>{
      (m.dias||[]).forEach(d=>{
        const ex=porFecha[d.fecha];
        if(!ex||(m.generadoEn||'')>(ex._gen||''))
          porFecha[d.fecha]={...d,_gen:m.generadoEn};
      });
    });
    return Object.values(porFecha).sort((a,b)=>a.fecha.localeCompare(b.fecha));
  }

  // ── Calendario flex (alineación correcta) ────────────────────────

  function _buildCalendario(dias, tieneBebe) {
    const hoy=Dates.today();
    const semanas=_agruparPorSemana(dias);
    // Número de filas: 1 adultos comida + (bebe comida)? + 1 adultos cena + (bebe cena)?
    const filas = tieneBebe ? 4 : 2;

    // Alturas fijas para garantizar alineación
    const ALT_HEADER = 56;   // px cabecera día
    const ALT_FILA   = 52;   // px cada fila de plato
    const ALT_LABEL  = 28;   // px separador "Comida" / "Cena"
    const totalAltura = ALT_HEADER + 2*(ALT_LABEL + (tieneBebe?2:1)*ALT_FILA);

    let html=`<div class="menu-cal">`;

    // ── Columna etiquetas (posición sticky izquierda) ──
    html+=`<div class="menu-cal-labels" style="min-height:${totalAltura}px">
      <div style="height:${ALT_HEADER}px"></div>`;

    ['Comida','Cena'].forEach(momento=>{
      html+=`<div class="menu-cal-bloque-label" style="height:${ALT_LABEL}px">
        <span class="menu-cal-momento-label">${momento==='Comida'?'🍽':'🌙'} ${momento}</span>
      </div>`;
      html+=`<div style="height:${ALT_FILA}px;display:flex;align-items:center;padding:0 var(--space-2)">
        <span style="font-size:10px;color:var(--color-text-muted);font-weight:600">Adultos</span>
      </div>`;
      if(tieneBebe) {
        html+=`<div style="height:${ALT_FILA}px;display:flex;align-items:center;padding:0 var(--space-2);background:rgba(59,130,246,.04)">
          <span style="font-size:10px;color:var(--color-text-muted);font-weight:600">Bebé</span>
        </div>`;
      }
    });
    html+=`</div>`;

    // ── Área scrollable ──
    html+=`<div class="menu-cal-scroll">`;
    semanas.forEach((semana,si)=>{
      semana.forEach(dia=>{
        const esHoy=dia.fecha===hoy;
        const esFinde=['Sábado','Domingo'].includes(Dates.dayName(dia.fecha));
        const esEspecial=!!dia.tipoEspecial;
        const config=App.getState().config||{};
        const nombreEsp=esEspecial?(config.tiposDiaEspecial||[]).find(t=>t.id===dia.tipoEspecial)?.nombre||'Día especial':'';
        html+=`<div class="menu-cal-col ${esHoy?'menu-cal-col--hoy':''} ${esFinde?'menu-cal-col--finde':''} ${esEspecial?'menu-cal-col--especial':''}"
                    style="min-height:${totalAltura}px" title="${UI.escapeHtml(nombreEsp)}">`;

        // Cabecera
        html+=`<div class="menu-cal-dia-header" style="height:${ALT_HEADER}px">
          <span class="menu-cal-dia-nombre">${Dates.dayShort(dia.fecha)}</span>
          <span class="menu-cal-dia-num">${Dates.fromISO(dia.fecha).getDate()}</span>
          <span class="menu-cal-dia-mes">${Dates.MESES_CORTO[Dates.fromISO(dia.fecha).getMonth()]}</span>
          ${esEspecial?`<span class="menu-cal-esp-dot" title="${UI.escapeHtml(nombreEsp)}">⚡</span>`:''}
          ${esHoy?'<span class="menu-cal-hoy-dot"></span>':''}
        </div>`;

        ['comida','cena'].forEach(momento=>{
          const bloque=dia[momento];
          // Separador de momento
          html+=`<div class="menu-cal-bloque-sep" style="height:${ALT_LABEL}px"></div>`;
          // Adultos
          const plMay=bloque?.activo&&bloque.platosMayores?.length
            ? bloque.platosMayores.map(p=>p.nombre).join(' + ')
            : (bloque?.activo===false||!bloque?'—':'–');
          const esEsp=!bloque?.activo;
          html+=`<div class="menu-cal-celda ${esEsp?'menu-cal-celda--esp':''}"
                      style="height:${ALT_FILA}px">${UI.escapeHtml(plMay)}</div>`;
          // Bebé
          if(tieneBebe){
            const plBebe=bloque?.activo&&bloque.platosBebe!==null&&bloque.platosBebe?.length
              ? bloque.platosBebe.map(p=>p.nombre).join(' + ')
              : (bloque?.platosBebe===null?'—':'–');
            html+=`<div class="menu-cal-celda menu-cal-celda--bebe ${esEsp?'menu-cal-celda--esp':''}"
                        style="height:${ALT_FILA}px">${UI.escapeHtml(plBebe)}</div>`;
          }
        });

        html+=`</div>`;
      });
      if(si<semanas.length-1) html+=`<div class="menu-cal-sep-semana"></div>`;
    });
    html+=`</div></div>`;
    return html;
  }

  // ── Calendario editable (paso 5) ─────────────────────────────────

  function _buildCalendarioEditable(dias, tieneBebe) {
    const hoy=Dates.today();
    const semanas=_agruparPorSemana(dias);
    const ALT_HEADER=56, ALT_FILA=52, ALT_LABEL=28;
    const totalAltura=ALT_HEADER+2*(ALT_LABEL+(tieneBebe?2:1)*ALT_FILA);

    let html=`<div class="menu-cal">`;

    // Etiquetas
    html+=`<div class="menu-cal-labels" style="min-height:${totalAltura}px">
      <div style="height:${ALT_HEADER}px"></div>`;
    ['Comida','Cena'].forEach(momento=>{
      html+=`<div class="menu-cal-bloque-label" style="height:${ALT_LABEL}px">
        <span class="menu-cal-momento-label">${momento==='Comida'?'🍽':'🌙'} ${momento}</span>
      </div>
      <div style="height:${ALT_FILA}px;display:flex;align-items:center;padding:0 var(--space-2)">
        <span style="font-size:10px;color:var(--color-text-muted);font-weight:600">Adultos</span>
      </div>`;
      if(tieneBebe) html+=`<div style="height:${ALT_FILA}px;display:flex;align-items:center;padding:0 var(--space-2);background:rgba(59,130,246,.04)">
        <span style="font-size:10px;color:var(--color-text-muted);font-weight:600">Bebé</span>
      </div>`;
    });
    html+=`</div><div class="menu-cal-scroll">`;

    semanas.forEach((semana,si)=>{
      semana.forEach(dia=>{
        const esHoy=dia.fecha===hoy;
        const esFinde=['Sábado','Domingo'].includes(Dates.dayName(dia.fecha));
        const esEspecial=!!dia.tipoEspecial;
        const config2=App.getState().config||{};
        const nombreEsp2=esEspecial?(config2.tiposDiaEspecial||[]).find(t=>t.id===dia.tipoEspecial)?.nombre||'Día especial':'';
        html+=`<div class="menu-cal-col ${esHoy?'menu-cal-col--hoy':''} ${esFinde?'menu-cal-col--finde':''} ${esEspecial?'menu-cal-col--especial':''}"
                    style="min-height:${totalAltura}px">`;
        html+=`<div class="menu-cal-dia-header" style="height:${ALT_HEADER}px">
          <span class="menu-cal-dia-nombre">${Dates.dayShort(dia.fecha)}</span>
          <span class="menu-cal-dia-num">${Dates.fromISO(dia.fecha).getDate()}</span>
          <span class="menu-cal-dia-mes">${Dates.MESES_CORTO[Dates.fromISO(dia.fecha).getMonth()]}</span>
          ${esEspecial?`<span class="menu-cal-esp-dot" title="${UI.escapeHtml(nombreEsp2)}">⚡</span>`:''}
          ${esHoy?'<span class="menu-cal-hoy-dot"></span>':''}
        </div>`;

        ['comida','cena'].forEach(momento=>{
          const bloque=dia[momento];
          html+=`<div class="menu-cal-bloque-sep" style="height:${ALT_LABEL}px"></div>`;
          const esEsp=!bloque?.activo;

          // Adultos editable
          const plMay=bloque?.platosMayores?.length
            ? bloque.platosMayores.map(p=>p.nombre).join(' + ') : '+';
          html+=`<div class="menu-cal-celda ${esEsp?'menu-cal-celda--esp':'menu-cal-celda--edit'}"
                      style="height:${ALT_FILA}px"
                      ${!esEsp?`data-fecha="${dia.fecha}" data-momento="${momento}" data-perfil="mayores"`:''}
                      >${esEsp?'—':UI.escapeHtml(plMay)}</div>`;

          // Bebé editable
          if(tieneBebe){
            const bebeNull=bloque?.platosBebe===null;
            const plBebe=bloque?.platosBebe?.length
              ? bloque.platosBebe.map(p=>p.nombre).join(' + ') : '+';
            html+=`<div class="menu-cal-celda menu-cal-celda--bebe ${esEsp||bebeNull?'menu-cal-celda--esp':'menu-cal-celda--edit'}"
                        style="height:${ALT_FILA}px"
                        ${!esEsp&&!bebeNull?`data-fecha="${dia.fecha}" data-momento="${momento}" data-perfil="bebe"`:''}
                        >${esEsp||bebeNull?'—':UI.escapeHtml(plBebe)}</div>`;
          }
        });
        html+=`</div>`;
      });
      if(si<semanas.length-1) html+=`<div class="menu-cal-sep-semana"></div>`;
    });
    html+=`</div></div>`;
    return html;
  }

  function _agruparPorSemana(dias) {
    const semanas=[];
    let actual=[],lunesAct=null;
    dias.forEach(d=>{
      const l=Dates.startOfWeek(d.fecha);
      if(l!==lunesAct){ if(actual.length) semanas.push(actual); actual=[]; lunesAct=l; }
      actual.push(d);
    });
    if(actual.length) semanas.push(actual);
    return semanas;
  }

  // ── Asistente ────────────────────────────────────────────────────

  function _iniciarAsistente() {
    _menuEnCurso={
      id:`menu-${Date.now()}`,
      fechaInicio:Dates.tomorrow(),
      fechaFin:Dates.addDays(Dates.tomorrow(),6),
      numSemanas:1,
      dias:[],
      estado:'borrador',
      generadoEn:null,
      confirmadoEn:null,
    };
    _paso=1; _renderAsistente();
  }

  function _renderAsistente() {
    const view=document.getElementById('view-menu');
    if(!view) return;
    view.innerHTML=`
      <div class="menu-asistente">
        <div class="menu-asist-header">
          ${_paso>1&&_paso<5?`<button class="btn-icon" id="menu-btn-back" style="color:var(--color-text)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg></button>`:''}
          <h1 class="module-title" style="flex:1">${_paso<5?`Paso ${_paso} de 4`:'Menú generado'}</h1>
          <button class="btn-text" id="menu-btn-cancelar">Cancelar</button>
        </div>
        ${_paso<5?`<div class="menu-progress">
          ${[1,2,3,4].map(p=>`<div class="menu-progress-step ${p<_paso?'done':p===_paso?'active':''}"></div>${p<4?'<div class="menu-progress-line"></div>':''}`).join('')}
        </div>`:''}
        <div id="menu-paso-content">${_renderPaso()}</div>
      </div>`;
    document.getElementById('menu-btn-back')?.addEventListener('click',()=>{ _paso--;_renderAsistente(); });
    document.getElementById('menu-btn-cancelar')?.addEventListener('click',()=>{ _paso=0;_renderVista(); });
    _bindPasoEvents();
  }

  function _renderPaso() {
    switch(_paso){
      case 1: return _renderPaso1();
      case 2: return _renderPaso2();
      case 3: return _renderPaso3();
      case 4: return _renderPaso4();
      case 5: return _renderPaso5();
      default: return '';
    }
  }

  // ── Paso 1: Horizonte con datepicker propio ──────────────────────

  function _renderPaso1() {
    return `
      <div class="menu-paso">
        <p class="menu-paso-desc">¿A partir de cuándo y cuántas semanas?</p>
        <div class="form-group">
          <label class="form-label">Fecha de inicio</label>
          <button class="form-control" id="menu-fecha-btn" style="text-align:left;cursor:pointer;font-weight:600;color:var(--color-primary)">
            📅 ${Dates.format(_menuEnCurso.fechaInicio,'long')}
          </button>
        </div>
        <div class="form-group">
          <label class="form-label">Número de semanas</label>
          <div class="menu-semanas-ctrl">
            <button class="inv-qty-btn" id="menu-semanas-minus">−</button>
            <div class="inv-qty-display">
              <span class="inv-qty-value" id="menu-semanas-val">${_menuEnCurso.numSemanas}</span>
              <span class="inv-qty-unit">semana${_menuEnCurso.numSemanas>1?'s':''}</span>
            </div>
            <button class="inv-qty-btn inv-qty-plus" id="menu-semanas-plus">+</button>
          </div>
        </div>
        <div class="menu-paso-footer">
          <button class="btn btn-primary btn-full" id="menu-paso1-next">Siguiente →</button>
        </div>
      </div>`;
  }

  // ── Paso 2: Días especiales ──────────────────────────────────────

  function _renderPaso2() {
    const config=App.getState().config||{};
    const tipos=config.tiposDiaEspecial||[];
    const dias=Dates.range(_menuEnCurso.fechaInicio, _menuEnCurso.numSemanas*7);
    return `
      <div class="menu-paso">
        <p class="menu-paso-desc">Marca los días que no comerás o cenarás en casa.</p>
        ${tipos.length===0?`<div class="card card-empty"><p class="text-sm">Sin tipos configurados.<br>Añádelos en <strong>Config → Días especiales</strong>.</p></div>`:''}
        <div class="menu-dias-especiales">
          ${dias.map(fecha=>{
            const esFinde=['Sábado','Domingo'].includes(Dates.dayName(fecha));
            const esp=(_menuEnCurso.dias.find(d=>d.fecha===fecha)||{}).tipoEspecial||'';
            return `<div class="menu-dia-esp-row ${esFinde?'menu-dia-finde':''}">
              <div class="menu-dia-esp-label">
                <span class="menu-dia-nombre">${Dates.dayShort(fecha)}</span>
                <span class="menu-dia-fecha">${Dates.format(fecha,'numshort')}</span>
              </div>
              <select class="form-control menu-dia-esp-select" data-fecha="${fecha}" style="flex:1">
                <option value="">Normal</option>
                ${tipos.map(t=>`<option value="${t.id}" ${esp===t.id?'selected':''}>${t.nombre}</option>`).join('')}
              </select>
            </div>`;
          }).join('')}
        </div>
        <div class="menu-paso-footer">
          <button class="btn btn-primary btn-full" id="menu-paso2-next">Siguiente →</button>
        </div>
      </div>`;
  }

  // ── Paso 3: Inventario ───────────────────────────────────────────

  function _renderPaso3() {
    const {inventario}=App.getState();
    const horizFin=_menuEnCurso.fechaFin||Dates.addDays(_menuEnCurso.fechaInicio,_menuEnCurso.numSemanas*7-1);
    const urgentes=(inventario||[]).filter(i=>{
      const s=Dates.expiryStatus(i.fechaCaducidad);
      return s==='expired'||s==='urgent'||i.forzarUso;
    });
    return `
      <div class="menu-paso">
        <p class="menu-paso-desc">Revisa artículos urgentes y marca los que quieres usar.</p>
        ${urgentes.length>0?`
          <div class="menu-inv-alertas">
            ${urgentes.map(item=>{
              const s=Dates.expiryStatus(item.fechaCaducidad);
              return `<div class="list-item" style="margin-bottom:var(--space-2)">
                <div class="list-item-content">
                  <div class="list-item-title">${UI.escapeHtml(item.nombre)}</div>
                  <div class="list-item-subtitle">
                    ${s==='expired'?'<span class="badge badge-red">Caducado</span>':
                      s==='urgent'?`<span class="badge badge-orange">Caduca en ${Dates.daysUntil(item.fechaCaducidad)}d</span>`:''}
                    ${item.forzarUso?'<span class="badge badge-blue">⭐ Forzado</span>':''}
                    ${item.ubicacion==='congelador'?'🧊':''}
                  </div>
                </div>
                <button class="btn btn-secondary btn-sm menu-toggle-forzar" data-id="${item.id}"
                        style="${item.forzarUso?'background:var(--color-primary-light);color:var(--color-primary)':''}">
                  ${item.forzarUso?'⭐ Forzado':'⭐ Usar'}
                </button>
              </div>`;
            }).join('')}
          </div>`:
          `<div class="card card-empty" style="padding:var(--space-6)"><p class="text-sm">✓ Sin artículos urgentes.</p></div>`}
        <div class="menu-paso-footer" style="display:flex;flex-direction:column;gap:var(--space-3)">
          <button class="btn btn-primary btn-full" id="menu-paso3-next">Generar menú →</button>
          <button class="btn btn-secondary btn-full" id="menu-paso3-skip">Omitir</button>
        </div>
      </div>`;
  }

  // ── Paso 4: Generando ────────────────────────────────────────────

  function _renderPaso4() {
    setTimeout(_generarMenu,100);
    return `<div class="menu-paso" style="text-align:center;padding:var(--space-12) 0">
      <div class="loading-spinner" style="margin:0 auto var(--space-6)"></div>
      <p class="loading-message" id="menu-gen-msg">Analizando inventario...</p>
    </div>`;
  }

  // ── Paso 5: Calendario editable ──────────────────────────────────

  function _renderPaso5() {
    if(!_menuEnCurso?.dias?.length) return '<p>Error: sin datos.</p>';
    const config=App.getState().config||{};
    const tieneBebe=(config.personas||[]).some(p=>p.tipo==='bebe');
    const diasCombinados=_combinarDiasDeMenus([_menuEnCurso]);
    return `
      <div class="menu-paso-tabla">
        <p class="text-sm text-muted" style="margin-bottom:var(--space-3)">Pulsa cualquier celda para cambiar el plato.</p>
        <div class="menu-info-panels">
          <button class="btn btn-secondary btn-sm" id="menu-panel-inv-btn">📦 Despensa</button>
        </div>
        <div id="menu-panel-inv" class="menu-info-panel hidden"></div>
        <div class="menu-calendario-wrapper" style="margin-top:var(--space-3)">
          ${_buildCalendarioEditable(diasCombinados,tieneBebe)}
        </div>
        <div class="menu-paso-footer" style="margin-top:var(--space-6)">
          <button class="btn btn-primary btn-full" id="menu-btn-confirmar">✓ Confirmar menú</button>
        </div>
      </div>`;
  }

  // ── Motor de generación ──────────────────────────────────────────

  async function _generarMenu() {
    const state=App.getState();
    const {platos,inventario,config}=state;
    const platosActivos=(platos||[]).filter(p=>p.activo!==false);
    _setGenMsg('Cargando historial...');
    const historial=await _cargarHistorialReciente(6);
    const usadosReciente=_buildUsadosReciente(historial);
    _setGenMsg('Calculando prioridades...');

    const horizInicio=_menuEnCurso.fechaInicio;
    const horizFin=Dates.addDays(horizInicio,_menuEnCurso.numSemanas*7-1);
    const consumidosAntesDel=_calcularConsumidosAntesDel(historial,horizInicio);
    const artsPrioritarios=new Set();

    (inventario||[]).forEach(item=>{
      const nombre=item.nombre.toLowerCase();
      const stockRestante=(item.cantidad||0)-(consumidosAntesDel[nombre]||0);
      if(stockRestante<=0) return;
      if(item.forzarUso){
        const yaEnHorizonte=historial.some(m=>
          (m.dias||[]).some(d=>d.fecha>=horizInicio&&d.fecha<=horizFin&&
            ['comida','cena'].some(mo=>
              [...(d[mo]?.platosMayores||[]),...(d[mo]?.platosBebe||[])].some(pl=>
                (platos||[]).find(p=>p.id===pl.id)?.ingredientes?.some(ing=>ing.nombre?.toLowerCase()===nombre)
              )
            )
          )
        );
        if(!yaEnHorizonte) artsPrioritarios.add(nombre);
      }
      if(item.fechaCaducidad){
        const s=Dates.expiryStatus(item.fechaCaducidad);
        if(item.fechaCaducidad>=horizInicio&&item.fechaCaducidad<=horizFin) artsPrioritarios.add(nombre);
        if((s==='urgent'||s==='expired')&&stockRestante>0) artsPrioritarios.add(nombre);
      }
    });

    _setGenMsg('Construyendo días...');
    const numDias=_menuEnCurso.numSemanas*7;
    const diasFechas=Dates.range(horizInicio,numDias);
    const tieneBebe=(config?.personas||[]).some(p=>p.tipo==='bebe');

    const dias=diasFechas.map(fecha=>{
      const diaEx=_menuEnCurso.dias.find(d=>d.fecha===fecha);
      const tipoEspId=diaEx?.tipoEspecial||null;
      const tipoEsp=tipoEspId?(config?.tiposDiaEspecial||[]).find(t=>t.id===tipoEspId):null;
      const afectaA=tipoEsp?.afectaA||'todos';
      const comidaMayAct = !tipoEsp?.afectaComida || afectaA==='bebe';
      const comidaBebAct = !tipoEsp?.afectaComida || afectaA==='mayores';
      const cenaMayAct   = !tipoEsp?.afectaCena   || afectaA==='bebe';
      const cenaBebAct   = !tipoEsp?.afectaCena   || afectaA==='mayores';
      // Día fácil: esDiaFacil=true → prioriza platos fáciles en los momentos configurados
      // facilComida/facilCena son independientes de afectaComida/afectaCena
      // Un tipo puede ser "fácil en comida" sin anular la cena, y viceversa
      const esDiaFacil    = !!(tipoEsp?.esDiaFacil);
      const facilComida   = esDiaFacil && (tipoEsp?.facilMomentos?.includes('comida') ?? true);
      const facilCena     = esDiaFacil && (tipoEsp?.facilMomentos?.includes('cena')   ?? true);
      return {
        fecha, diaSemana:Dates.dayName(fecha), tipoEspecial:tipoEspId,
        esDiaFacil, facilComida, facilCena,
        comida:{ activo:comidaMayAct||(tieneBebe&&comidaBebAct),
          platosMayores:[], platosBebe:tieneBebe?[]:null,
          _mayActivo:comidaMayAct, _bebeActivo:comidaBebAct },
        cena:{ activo:cenaMayAct||(tieneBebe&&cenaBebAct),
          platosMayores:[], platosBebe:tieneBebe?[]:null,
          _mayActivo:cenaMayAct, _bebeActivo:cenaBebAct },
      };
    });

    _setGenMsg('Generando platos...');
    const usadosSemana   = new Map();  // platoId → [diasUsados] para detectar días consecutivos
    const contadorGrupos = {};         // grupo → veces usada esta semana (equilibrio nutricional)
    const usadosBebe     = [];  // array de ids (permite duplicados para contar usos)
    const protPorDia     = {};
    const cfgMenus       = config?.configuracionMenus || {};
    const sobrasBebe     = {};         // platoId → días restantes

    const MAX_SEMANA     = 2;          // máx veces por semana adultos
    const MAX_CONSECUTIVOS = 1;        // máx días seguidos el mismo plato adultos

    for(let di=0; di<dias.length; di++){
      const dia = dias[di];

      // ── COMIDA ──────────────────────────────────────────────────
      const blComida = dia.comida;
      if(blComida.activo){

        // 1. Adultos comida
        if(blComida._mayActivo){
          let cands = _filtrarMayores({
            platos:platosActivos, momento:'comida',
            usadosSemana, usadosReciente, artsPrioritarios,
            protPorDia, diaIndex:di, esCena:false, cfgMenus,
            soloFacil: dia.facilComida, contadorGrupos,
          });
          // Fallback 1: relajar distancia mínima
          if(!cands.length){
            cands = _filtrarMayores({
              platos:platosActivos, momento:'comida',
              usadosSemana, usadosReciente:[], artsPrioritarios,
              protPorDia, diaIndex:di, esCena:false, cfgMenus,
              soloFacil: dia.facilComida, contadorGrupos, relajarDistancia:true,
            });
          }
          // Fallback 2: ignorar todos los límites excepto tipoMenu/tipoComida
          if(!cands.length){
            cands = platosActivos.filter(p=>
              (p.tipoMenu?.includes('mayores')||p.tipoMenu?.includes('todos')) &&
              p.tipoPlato !== 'segundo' &&
              (p.tipoComida?.includes('comida')||p.tipoComida?.includes('ambos'))
            );
          }
          const p = _elegirPlato(cands, [...artsPrioritarios], inventario||[]);
          if(p){
            _registrarMayor(usadosSemana, p.id, di);
            _registrarProteina(protPorDia, di, p);
            _registrarGrupo(contadorGrupos, p);
            if((p.diasSobras||0) > 0 && tieneBebe)
              sobrasBebe[p.id] = (sobrasBebe[p.id]||0) + p.diasSobras;

            if(p.tipoPlato === 'primero'){
              const segundo = _elegirSegundoMayores(platosActivos, usadosSemana, usadosReciente, di, 'comida');
              blComida.platosMayores = segundo
                ? [{id:p.id,nombre:p.nombre},{id:segundo.id,nombre:segundo.nombre}]
                : [{id:p.id,nombre:p.nombre}];
              if(segundo) _registrarMayor(usadosSemana, segundo.id, di);
            } else {
              blComida.platosMayores = [{id:p.id,nombre:p.nombre}];
            }
          }
        }

        // 2. Bebé comida
        if(tieneBebe && blComida._bebeActivo){
          // Pasa los días futuros para que el bebé solo tenga platos propios
          // si los adultos los van a comer próximamente (minimizar cocciones)
          const diasFuturos = dias.slice(di+1, di+3);  // próximos 2 días
          blComida.platosBebe = _generarBloqueBebeComida(
            blComida.platosMayores, platosActivos,
            usadosBebe, usadosReciente, artsPrioritarios,
            sobrasBebe, cfgMenus, dia.facilComida, inventario||[],
            diasFuturos
          );
        }
      }

      // ── CENA ────────────────────────────────────────────────────
      const blCena = dia.cena;
      if(blCena.activo){

        // 1. Adultos cena — siempre plato único
        if(blCena._mayActivo){
          let cands = _filtrarMayores({
            platos:platosActivos, momento:'cena',
            usadosSemana, usadosReciente, artsPrioritarios,
            protPorDia, diaIndex:di, esCena:true, cfgMenus,
            forzarUnico:true, soloFacil: dia.facilCena, contadorGrupos,
          });
          // Fallback 1: relajar distancia mínima entre repeticiones
          if(!cands.length){
            cands = _filtrarMayores({
              platos:platosActivos, momento:'cena',
              usadosSemana, usadosReciente:[], artsPrioritarios,
              protPorDia, diaIndex:di, esCena:true, cfgMenus,
              forzarUnico:true, soloFacil: dia.facilCena, contadorGrupos,
              relajarDistancia: true,
            });
          }
          // Fallback 2: ignorar límite semanal (último recurso)
          if(!cands.length){
            cands = platosActivos.filter(p=>
              (p.tipoMenu?.includes('mayores')||p.tipoMenu?.includes('todos')) &&
              p.tipoPlato==='unico' &&
              (p.tipoComida?.includes('cena')||p.tipoComida?.includes('ambos'))
            );
          }
          const p = _elegirPlato(cands, [...artsPrioritarios], inventario||[]);
          if(p){
            blCena.platosMayores = [{id:p.id,nombre:p.nombre}];
            _registrarMayor(usadosSemana, p.id, di);
            _registrarProteina(protPorDia, di, p);
            _registrarGrupo(contadorGrupos, p);
          }
        }

        // 2. Bebé cena — usa lo que ya se cocinó (minimizar cocciones)
        if(tieneBebe && blCena._bebeActivo){
          blCena.platosBebe = _generarBloqueBebeConSobras(
            blCena.platosMayores, platosActivos,
            usadosBebe, usadosReciente, artsPrioritarios,
            sobrasBebe, cfgMenus, dia.facilCena, 'cena', inventario||[],
            blComida.platosMayores  // platos que comieron los adultos al mediodía HOY
          );
        }
      }
    }


    _menuEnCurso.dias=dias;
    _menuEnCurso.generadoEn=new Date().toISOString();
    _setGenMsg('¡Listo!');
    await new Promise(r=>setTimeout(r,400));
    _paso=5; _renderAsistente();
  }

  // ── Helpers motor ────────────────────────────────────────────────

  function _calcularConsumidosAntesDel(historial, horizInicio) {
    // Suma las cantidades de ingredientes en menús con fechas ANTES del horizonte
    const consumidos={};
    historial.forEach(m=>{
      (m.dias||[]).filter(d=>d.fecha<horizInicio).forEach(d=>{
        ['comida','cena'].forEach(mo=>{
          const bloque=d[mo];
          if(!bloque?.activo) return;
          [...(bloque.platosMayores||[]),...(bloque.platosBebe||[])].forEach(pl=>{
            const plObj=(App.getState().platos||[]).find(p=>p.id===pl.id);
            (plObj?.ingredientes||[]).forEach(ing=>{
              const k=(ing.nombre||'').toLowerCase();
              consumidos[k]=(consumidos[k]||0)+(ing.cantidad||1);
            });
          });
        });
      });
    });
    return consumidos;
  }

  // ── Contador de uso adultos (máx 2 veces por semana) ────────────

  // ── Registro de uso adultos ──────────────────────────────────────

  /**
   * Registra que un plato adulto se usó en el día diaIndex.
   * Guarda array de días para detectar consecutivos.
   */
  function _registrarMayor(usadosSemana, id, diaIndex) {
    if(!usadosSemana.has(id)) usadosSemana.set(id, []);
    const arr = usadosSemana.get(id);
    if(!arr.includes(diaIndex)) arr.push(diaIndex); // evita doble registro si comida+cena mismo día
  }

  /** Registra el grupo alimenticio de un plato para el control semanal */
  function _registrarGrupo(contadorGrupos, plato) {
    (plato.etiquetas||[]).forEach(e => {
      contadorGrupos[e] = (contadorGrupos[e]||0) + 1;
    });
  }

  // ── Filtro candidatos adultos ────────────────────────────────────

  function _filtrarMayores({platos,momento,usadosSemana,usadosReciente,
    artsPrioritarios,protPorDia,diaIndex,esCena,soloTipo,cfgMenus,forzarUnico,soloFacil,contadorGrupos}){
    const eqCC = cfgMenus?.equilibrioComidaCena !== false;
    const eqP  = cfgMenus?.equilibrioProteinas  !== false;
    const MAX  = 2;

    return platos.filter(p=>{
      if(!p.tipoMenu?.includes('mayores') && !p.tipoMenu?.includes('todos')) return false;
      if(soloTipo && p.tipoPlato !== soloTipo) return false;
      if(forzarUnico && p.tipoPlato !== 'unico') return false;
      if(!soloTipo && !forzarUnico && p.tipoPlato === 'segundo') return false;
      if(!p.tipoComida?.includes(momento) && !p.tipoComida?.includes('ambos')) return false;
      const diasUsados = usadosSemana.get(p.id) || [];
      if(diasUsados.length >= MAX) return false;
      if(diasUsados.length > 0){
        const ultimoDia = diasUsados[diasUsados.length - 1];
        if(diaIndex - ultimoDia <= 1) return false;
      }
      const minSem = p.frecuenciaMinSemanas || 2;
      if(usadosReciente[p.id] && usadosReciente[p.id] < minSem) return false;
      if(soloFacil && !p.preparacionFacil) return false;

      // Reglas alimenticias — limita grupos sobreutilizados
      if(contadorGrupos && eqP){
        const etqs = (p.etiquetas||[]).map(e=>e.toLowerCase());
        if(etqs.includes('carne-roja') && (contadorGrupos['carne-roja']||0) >= 1) return false;
        const totalPescado = (contadorGrupos['pescado-blanco']||0)+(contadorGrupos['pescado-azul']||0);
        if((etqs.includes('pescado-blanco')||etqs.includes('pescado-azul')) && totalPescado >= 4) return false;
        if(etqs.includes('legumbre') && (contadorGrupos['legumbre']||0) >= 4) return false;
        if(etqs.includes('huevo') && (contadorGrupos['huevo']||0) >= 4) return false;
        if(etqs.includes('hidratos') && (contadorGrupos['hidratos']||0) >= 7) return false;
        const totalCarne = (contadorGrupos['carne-ave']||0)+(contadorGrupos['carne-roja']||0);
        if((etqs.includes('carne-ave')||etqs.includes('carne-roja')) && totalCarne >= 3) return false;
      }

      if(eqCC && esCena){
        const etqs = (p.etiquetas||[]).map(e=>e.toLowerCase());
        if(etqs.some(e=>['legumbre','guiso','cocido','paella','fabada'].includes(e))) return false;
      }
      if(eqP && diaIndex >= 2){
        const prot = _detectarProteina(p);
        if(prot && protPorDia[diaIndex-1]===prot && protPorDia[diaIndex-2]===prot) return false;
      }
      return true;
    });
  }


  /** Busca un segundo para adultos */
  function _elegirSegundoMayores(platosActivos, usadosSemana, usadosReciente, diaIndex, momento) {
    const MAX = 2;
    const cands = platosActivos.filter(p => {
      if(p.tipoPlato !== 'segundo') return false;
      if(!p.tipoMenu?.includes('mayores') && !p.tipoMenu?.includes('todos')) return false;
      if(!p.tipoComida?.includes(momento) && !p.tipoComida?.includes('ambos')) return false;
      const diasUsados = usadosSemana.get(p.id) || [];
      if(diasUsados.length >= MAX) return false;
      if(diasUsados.length > 0 && diaIndex - diasUsados[diasUsados.length-1] <= 1) return false;
      const minSem = p.frecuenciaMinSemanas || 2;
      if(usadosReciente[p.id] && usadosReciente[p.id] < minSem) return false;
      return true;
    });
    if(!cands.length) return null;
    return cands[Math.floor(Math.random() * cands.length)];
  }

  // ── Generación bloque bebé ───────────────────────────────────────

  /**
   * Genera el bloque de bebé para la COMIDA.
   * Prioridad: compat con adultos → sobras → plato propio.
   * Siempre garantiza primero+segundo salvo plato único.
   */
  /**
   * Genera el bloque de bebé para la COMIDA.
   * Regla principal: minimizar cocciones.
   * Prioridad:
   *   1. Platos de adultos ese día que son compatibles con bebé
   *   2. Sobras de días anteriores (platos ya cocinados)
   *   3. Plato propio de bebé SOLO si los adultos lo comerán en los próximos 2 días
   *      (para evitar cocinar algo exclusivamente para el bebé)
   */
  function _generarBloqueBebeComida(platosAdultos, platosActivos, usadosBebe,
    usadosReciente, artsPrioritarios, sobrasBebe, cfgMenus, soloFacil, inventario,
    diasFuturos) {

    // 1. Platos de adultos compatibles con bebé ese mismo día
    const compatAdultos = (platosAdultos||[]).filter(pa => {
      const db = platosActivos.find(p => p.id === pa.id);
      return db && (db.tipoMenu.includes('todos') || db.tipoMenu.includes('bebe'));
    });

    if(compatAdultos.length > 0){
      return _asegurarPrimeroSegundo(compatAdultos, platosActivos, usadosBebe, usadosReciente, 'comida');
    }

    // 2. Sobras disponibles de días anteriores
    const sobra = _elegirDeSobras(sobrasBebe, platosActivos);
    if(sobra){
      sobrasBebe[sobra.id]--;
      if(sobrasBebe[sobra.id] <= 0) delete sobrasBebe[sobra.id];
      return _completarPrimeroSegundo([{id:sobra.id,nombre:sobra.nombre}],
        platosActivos, sobra, usadosBebe, usadosReciente, 'comida');
    }

    // 3. Plato propio de bebé:
    //    - Si es tipoMenu:['bebe'] → se usa libremente (puré, etc., cocina específica)
    //    - Si es tipoMenu:['todos'] → solo si los adultos lo comerán en próximos 2 días
    const cands = _filtrarCandidatosBebe(platosActivos, 'comida', usadosBebe, usadosReciente);
    
    // Primero intenta con platos exclusivos de bebé (sin restricción de adultos)
    const candsSoloBebe = cands.filter(p => 
      p.tipoMenu?.length === 1 && p.tipoMenu[0] === 'bebe'
    );
    const pSoloBebe = _elegirPlato(candsSoloBebe, [...artsPrioritarios], inventario);
    if(pSoloBebe){
      usadosBebe.push(pSoloBebe.id);
      if((pSoloBebe.diasSobras||0) > 0) sobrasBebe[pSoloBebe.id] = (sobrasBebe[pSoloBebe.id]||0) + pSoloBebe.diasSobras;
      return _completarPrimeroSegundo([{id:pSoloBebe.id,nombre:pSoloBebe.nombre}],
        platosActivos, pSoloBebe, usadosBebe, usadosReciente, 'comida');
    }

    // Platos 'todos' solo si adultos los comerán próximamente
    const platosAdultosFuturos = new Set(
      (diasFuturos||[]).flatMap(d =>
        [...(d.comida?.platosMayores||[]), ...(d.cena?.platosMayores||[])]
          .map(p => p.id)
      )
    );
    const candsCompartidos = cands.filter(p => platosAdultosFuturos.has(p.id));
    const platoBebe = candsCompartidos.length
      ? _elegirPlato(candsCompartidos, [...artsPrioritarios], inventario)
      : null;

    if(platoBebe){
      usadosBebe.push(platoBebe.id);
      if((platoBebe.diasSobras||0) > 0) sobrasBebe[platoBebe.id] = (sobrasBebe[platoBebe.id]||0) + platoBebe.diasSobras;
      return _completarPrimeroSegundo([{id:platoBebe.id,nombre:platoBebe.nombre}],
        platosActivos, platoBebe, usadosBebe, usadosReciente, 'comida');
    }

    // Fallback: cualquier plato de bebé aunque no coincida con adultos
    const pFallback = _elegirPlato(cands, [...artsPrioritarios], inventario);
    if(pFallback){
      usadosBebe.push(pFallback.id);
      if((pFallback.diasSobras||0) > 0) sobrasBebe[pFallback.id] = (sobrasBebe[pFallback.id]||0) + pFallback.diasSobras;
      return _completarPrimeroSegundo([{id:pFallback.id,nombre:pFallback.nombre}],
        platosActivos, pFallback, usadosBebe, usadosReciente, 'comida');
    }

    return platosAdultos||[];
  }

  /**
   * Genera el bloque de bebé para la CENA.
   * Regla: minimizar cocciones — el bebé cena SIEMPRE lo que ya se cocinó.
   * Prioridad:
   *   1. Sobras del mediodía de ese mismo día (platosMayores comida)
   *   2. Plato de cena de adultos si es compatible
   *   3. Sobras de días anteriores registradas en sobrasBebe
   *   4. NUNCA plato exclusivo de bebé en cena — si no hay nada, repite sobra disponible
   */
  function _generarBloqueBebeConSobras(platosAdultos, platosActivos, usadosBebe,
    usadosReciente, artsPrioritarios, sobrasBebe, cfgMenus, soloFacil, momento, inventario,
    platosComidaHoy) {

    // 1. Sobras del mediodía de HOY (lo que comieron los adultos al mediodía)
    // Son los mejores candidatos — ya está cocinado y es del mismo día
    if(platosComidaHoy?.length){
      const compatHoy = platosComidaHoy.filter(pa => {
        const db = platosActivos.find(p => p.id === pa.id);
        return db && (db.tipoMenu.includes('todos') || db.tipoMenu.includes('bebe'));
      });
      if(compatHoy.length > 0){
        return _completarPrimeroSegundo([compatHoy[0]],
          platosActivos, platosActivos.find(p=>p.id===compatHoy[0].id),
          usadosBebe, usadosReciente, momento);
      }
    }

    // 2. Plato de cena de adultos si es compatible con bebé
    const platoCenaAd = (platosAdultos||[])[0];
    const dbCenaAd = platoCenaAd
      ? platosActivos.find(p => p.id===platoCenaAd.id &&
          (p.tipoMenu.includes('todos') || p.tipoMenu.includes('bebe')))
      : null;
    if(dbCenaAd){
      return _completarPrimeroSegundo([{id:dbCenaAd.id,nombre:dbCenaAd.nombre}],
        platosActivos, dbCenaAd, usadosBebe, usadosReciente, momento);
    }

    // 3. Sobras registradas de días anteriores
    const sobra = _elegirDeSobras(sobrasBebe, platosActivos);
    if(sobra){
      sobrasBebe[sobra.id]--;
      if(sobrasBebe[sobra.id] <= 0) delete sobrasBebe[sobra.id];
      return _completarPrimeroSegundo([{id:sobra.id,nombre:sobra.nombre}],
        platosActivos, sobra, usadosBebe, usadosReciente, momento);
    }

    // 4. Fallback: repite algo de lo que comió el bebé al mediodía si hay
    // (nunca generar plato exclusivo de bebé en cena)
    if(platosComidaHoy?.length){
      return _completarPrimeroSegundo([platosComidaHoy[0]],
        platosActivos, platosActivos.find(p=>p.id===platosComidaHoy[0].id),
        usadosBebe, usadosReciente, momento);
    }

    return platosAdultos || [];
  }

  // ── Helpers bebé ─────────────────────────────────────────────────

  /** Filtra platos válidos para bebé — en cena acepta también platos de comida */
  function _filtrarCandidatosBebe(platos, momento, usadosBebe, usadosReciente) {
    return platos.filter(p => {
      if(!p.tipoMenu?.includes('bebe') && !p.tipoMenu?.includes('todos')) return false;
      if(p.tipoPlato === 'segundo') return false;
      // Regla: en cena del bebé se aceptan platos de comida o de ambos
      const momentoOk = p.tipoComida?.includes(momento) ||
                        p.tipoComida?.includes('ambos') ||
                        (momento === 'cena' && p.tipoComida?.includes('comida'));
      if(!momentoOk) return false;
      if(!p.permiteRepeticion && usadosBebe.includes(p.id)) return false;
      const minSem = p.frecuenciaMinSemanas || 2;
      if(usadosReciente[p.id] && usadosReciente[p.id] < minSem) return false;
      return true;
    });
  }

  /**
   * Dado un array de platos iniciales del bebé:
   * - Si el primer plato es 'unico' → devuelve tal cual
   * - Si es 'primero' → busca un segundo
   * - Si es 'segundo' → busca un primero (error de configuración, intenta corregir)
   */
  function _completarPrimeroSegundo(platosRef, platosActivos, platoObjeto, usadosBebe, usadosReciente, momento) {
    // Busca el tipo real del plato en la base de datos (puede que platoObjeto no tenga tipoPlato)
    const platoDBId = platoObjeto?.id || platosRef?.[0]?.id;
    const platoDB   = platoDBId ? platosActivos.find(p=>p.id===platoDBId) : null;
    const tipo      = platoDB?.tipoPlato || platoObjeto?.tipoPlato || 'unico';

    if(tipo === 'unico') return platosRef;  // plato único: no necesita complemento

    if(tipo === 'segundo'){
      // Tenemos un segundo solo: buscamos un primero para ponerlo antes
      const primero = _elegirPrimeroBebe(platosActivos, usadosBebe, usadosReciente, momento);
      if(primero){ usadosBebe.push(primero.id); return [{id:primero.id,nombre:primero.nombre}, ...platosRef]; }
      return platosRef;
    }

    if(tipo === 'primero'){
      // Tenemos un primero: buscamos un segundo
      const segundo = _elegirSegundoBebe(platosActivos, usadosBebe, usadosReciente, momento);
      if(segundo){ usadosBebe.push(segundo.id); return [...platosRef, {id:segundo.id,nombre:segundo.nombre}]; }
    }

    return platosRef;
  }

  /**
   * Dado array de platos de adultos compatibles con bebé,
   * asegura que el bebé tenga primero+segundo si el primero no es único.
   */
  function _asegurarPrimeroSegundo(compatAdultos, platosActivos, usadosBebe, usadosReciente, momento) {
    if(!compatAdultos.length) return [];
    // Si ya tiene dos platos, devuelve tal cual
    if(compatAdultos.length >= 2) return compatAdultos;
    const primerRef = compatAdultos[0];
    const primerDB  = platosActivos.find(p => p.id === primerRef.id);
    const tipo      = primerDB?.tipoPlato || 'unico';

    if(tipo === 'unico') return compatAdultos;  // plato único: no añadir segundo

    if(tipo === 'segundo'){
      // Solo tenemos un segundo: buscamos primero
      const primero = _elegirPrimeroBebe(platosActivos, usadosBebe, usadosReciente, momento);
      if(primero){ usadosBebe.push(primero.id); return [{id:primero.id,nombre:primero.nombre}, ...compatAdultos]; }
      return compatAdultos;
    }

    // tipo === 'primero': busca segundo
    const segundo = _elegirSegundoBebe(platosActivos, usadosBebe, usadosReciente, momento);
    if(segundo){ usadosBebe.push(segundo.id); return [...compatAdultos, {id:segundo.id,nombre:segundo.nombre}]; }
    return compatAdultos;
  }

  function _elegirPrimeroBebe(platosActivos, usadosBebe, usadosReciente, momento) {
    const cands = platosActivos.filter(p => {
      // Acepta platos para bebé O para todos
      if(!p.tipoMenu?.includes('bebe') && !p.tipoMenu?.includes('todos')) return false;
      if(p.tipoPlato !== 'primero') return false;
      // En cena del bebé acepta platos de comida o ambos (regla interna)
      const momentoOk = p.tipoComida?.includes(momento) ||
                        p.tipoComida?.includes('ambos') ||
                        (momento === 'cena' && p.tipoComida?.includes('comida'));
      if(!momentoOk) return false;
      if(!p.permiteRepeticion && usadosBebe.includes(p.id)) return false;
      return true;
    });
    if(!cands.length) return null;
    // Prioriza los menos usados
    const conUso = cands.map(p => ({p, usos: usadosBebe.filter(id=>id===p.id).length}));
    conUso.sort((a,b) => a.usos - b.usos);
    const minUsos = conUso[0].usos;
    const menosUsados = conUso.filter(x => x.usos === minUsos).map(x => x.p);
    return menosUsados[Math.floor(Math.random() * menosUsados.length)];
  }

  function _elegirSegundoBebe(platosActivos, usadosBebe, usadosReciente, momento) {
    const cands = platosActivos.filter(p => {
      if(p.tipoPlato !== 'segundo') return false;
      // Acepta platos para bebé O para todos
      if(!p.tipoMenu?.includes('bebe') && !p.tipoMenu?.includes('todos')) return false;
      // En cena del bebé acepta segundos de comida o ambos (regla interna)
      const momentoOk = p.tipoComida?.includes(momento) ||
                        p.tipoComida?.includes('ambos') ||
                        (momento === 'cena' && p.tipoComida?.includes('comida'));
      if(!momentoOk) return false;
      // Límite de 3 usos por semana aunque permita repetición
      const usosActuales = usadosBebe.filter(id => id === p.id).length;
      if(usosActuales >= 3) return false;
      if(!p.permiteRepeticion && usadosBebe.includes(p.id)) return false;
      return true;
    });
    if(!cands.length) return null;
    // Prioriza los menos usados esta semana
    const conUso = cands.map(p => ({p, usos: usadosBebe.filter(id=>id===p.id).length}));
    conUso.sort((a,b) => a.usos - b.usos);
    const minUsos = conUso[0].usos;
    const menosUsados = conUso.filter(x => x.usos === minUsos).map(x => x.p);
    return menosUsados[Math.floor(Math.random() * menosUsados.length)];
  }

  function _elegirDeSobras(sobrasBebe, platosActivos) {
    const disponibles = Object.keys(sobrasBebe).filter(id => sobrasBebe[id] > 0);
    if(!disponibles.length) return null;
    disponibles.sort((a,b) => sobrasBebe[b] - sobrasBebe[a]);
    return platosActivos.find(p => p.id === disponibles[0]) || null;
  }


  function _elegirPlato(candidatos,artsPrioritarios,inventario){
    if(!candidatos.length) return null;
    const puntuados=candidatos.map(p=>{
      let score=Math.random()*10;
      const ingNames=(p.ingredientes||[]).map(i=>(i.nombre||'').toLowerCase());
      score+=ingNames.filter(n=>artsPrioritarios.includes(n)).length*20;
      return{plato:p,score};
    });
    return puntuados.sort((a,b)=>b.score-a.score)[0].plato;
  }

  function _detectarProteina(plato){
    const etqs=(plato.etiquetas||[]).map(e=>e.toLowerCase());
    const nombre=plato.nombre.toLowerCase();
    for(const [tipo,palabras] of Object.entries(ETIQUETAS_PROTEINA)){
      if(palabras.some(p=>etqs.includes(p)||nombre.includes(p))) return tipo;
    }
    return null;
  }

  function _registrarProteina(registro,diaIndex,plato){
    const prot=_detectarProteina(plato);
    if(prot) registro[diaIndex]=prot;
  }

  function _buildUsadosReciente(historial){
    const res={};
    historial.forEach((menu,semIdx)=>{
      const sem=semIdx+1;
      (menu.dias||[]).forEach(d=>{
        ['comida','cena'].forEach(m=>{
          [...(d[m]?.platosMayores||[]),...(d[m]?.platosBebe||[])].forEach(p=>{
            if(!res[p.id]||res[p.id]>sem) res[p.id]=sem;
          });
        });
      });
    });
    return res;
  }

  async function _cargarHistorialReciente(n){
    try{
      const arch=await Drive.listMenuFiles();
      const menus=[];
      for(const f of arch.slice(0,n)){
        const m=await Drive.readMenuJson(f.id).catch(()=>null);
        if(m) menus.push(m);
      }
      return menus;
    }catch{return[];}
  }

  function _setGenMsg(msg){
    const el=document.getElementById('menu-gen-msg');
    if(el) el.textContent=msg;
  }

  // ── Confirmar ────────────────────────────────────────────────────

  async function _confirmarMenu(){
    const btn=document.getElementById('menu-btn-confirmar');
    if(btn){btn.disabled=true;btn.textContent='Guardando...';}
    _menuEnCurso.estado='confirmado';
    _menuEnCurso.confirmadoEn=new Date().toISOString();
    const fileName=`semana_${_menuEnCurso.fechaInicio}.json`;
    await Drive.writeMenuJson(fileName,_menuEnCurso);
    const notifs=Notificaciones.generarParaMenu(_menuEnCurso);
    const config={...(App.getState().config||{})};
    if(!config.notificaciones) config.notificaciones={};
    config.notificaciones.pendientes=notifs;
    await App.setState('config',config);
    App.getState().menuActual=_menuEnCurso;
    UI.showToast('Menú confirmado ✓','success',2000);
    await new Promise(r=>setTimeout(r,800));
    App.navigate('compra');
  }

  // ── Popup platos ─────────────────────────────────────────────────

  function _abrirPopupPlato(fecha, momento, perfil){
    const state = App.getState();
    const platosActivos = (state.platos||[]).filter(p=>p.activo!==false);
    const dia = _menuEnCurso.dias.find(d=>d.fecha===fecha);
    const arr = perfil==='bebe' ? 'platosBebe' : 'platosMayores';
    const platosActuales = dia?.[momento]?.[arr] || [];

    // Compatibilidad: bebé en cena también acepta platos de comida
    const compatibles = platosActivos.filter(p=>{
      const mOk = p.tipoComida?.includes(momento) || p.tipoComida?.includes('ambos') ||
                  (perfil==='bebe' && momento==='cena' && p.tipoComida?.includes('comida'));
      const pOk = perfil==='bebe'
        ? p.tipoMenu?.includes('bebe')||p.tipoMenu?.includes('todos')
        : p.tipoMenu?.includes('mayores')||p.tipoMenu?.includes('todos');
      return mOk && pOk;
    });

    const soloUnicos   = compatibles.filter(p=>p.tipoPlato==='unico');
    const primeros     = compatibles.filter(p=>p.tipoPlato==='primero');
    const segundos     = compatibles.filter(p=>p.tipoPlato==='segundo');
    const esCenaAdulto = momento==='cena' && perfil==='mayores';

    const container = document.createElement('div');
    container.innerHTML = `
      <div class="search-bar" style="margin-bottom:var(--space-3)">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input type="search" id="popup-plato-search" placeholder="Buscar..." autocomplete="off"/>
      </div>

      <!-- Selección actual -->
      <div id="popup-seleccion-actual" style="margin-bottom:var(--space-3)">
        ${_buildSeleccionActual(platosActuales)}
      </div>

      <!-- Tabs para filtrar por tipo -->
      <div class="pl-chips pl-chips--form" style="margin-bottom:var(--space-3)" id="popup-tabs">
        <button class="pl-chip active" data-tab="todos">Todos</button>
        <button class="pl-chip" data-tab="unico">🍽 Único</button>
        ${!esCenaAdulto ? '<button class="pl-chip" data-tab="primero">1️⃣ Primero</button>' : ''}
        ${!esCenaAdulto ? '<button class="pl-chip" data-tab="segundo">2️⃣ Segundo</button>' : ''}
      </div>

      <div id="popup-plato-list" class="popup-plato-list">${_buildPopupPlatos(compatibles,'')}</div>`;

    const modal = UI.showModal({
      title: `Editar — ${momento==='comida'?'🍽 Comida':'🌙 Cena'} · ${perfil==='bebe'?'Bebé':'Adultos'}`,
      content: container,
    });

    setTimeout(()=>{
      let tabActual = 'todos';
      let filtroTexto = '';

      function getFiltrados() {
        let pool = tabActual==='todos' ? compatibles
          : tabActual==='unico'   ? soloUnicos
          : tabActual==='primero' ? primeros
          : segundos;
        if(filtroTexto) pool = pool.filter(p=>p.nombre.toLowerCase().includes(filtroTexto));
        return pool;
      }

      function refresh() {
        const list = document.getElementById('popup-plato-list');
        if(list) list.innerHTML = _buildPopupPlatos(getFiltrados(),'');
        _bindPopupPlatos(fecha, momento, perfil, modal, arr, container);
      }

      // Tabs
      container.querySelectorAll('#popup-tabs .pl-chip').forEach(btn=>{
        btn.addEventListener('click',()=>{
          container.querySelectorAll('#popup-tabs .pl-chip').forEach(b=>b.classList.remove('active'));
          btn.classList.add('active');
          tabActual = btn.dataset.tab;
          refresh();
        });
      });

      // Búsqueda
      const inp = document.getElementById('popup-plato-search');
      inp?.focus();
      inp?.addEventListener('input',e=>{ filtroTexto=e.target.value.toLowerCase(); refresh(); });

      _bindPopupPlatos(fecha, momento, perfil, modal, arr, container);
    }, 100);
  }

  function _buildSeleccionActual(platos) {
    if(!platos.length) return '<p class="text-sm text-muted" style="margin-bottom:0">Sin platos asignados. Selecciona abajo.</p>';
    return `<div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap">
      <span class="text-sm text-muted">Actual:</span>
      ${platos.map((p,i)=>`
        <span class="badge badge-blue">${i===0?'1º':'2º'} ${UI.escapeHtml(p.nombre)}
          <button type="button" data-rm-idx="${i}" style="margin-left:4px;font-weight:700;color:var(--color-danger)">×</button>
        </span>`).join('')}
    </div>`;
  }

  function _buildPopupPlatos(platos, filtro){
    const f = filtro ? platos.filter(p=>p.nombre.toLowerCase().includes(filtro)) : platos;
    if(!f.length) return `<p class="text-sm text-muted" style="padding:var(--space-4)">Sin resultados.</p>`;
    return f.sort((a,b)=>a.nombre.localeCompare(b.nombre,'es')).map(p=>`
      <button class="popup-plato-item" data-id="${p.id}" data-nombre="${UI.escapeHtml(p.nombre)}" data-tipo="${p.tipoPlato}">
        <div style="display:flex;align-items:center;gap:var(--space-2);flex:1">
          <span class="badge badge-gray" style="font-size:10px;flex-shrink:0">
            ${{unico:'Único',primero:'1º',segundo:'2º'}[p.tipoPlato]||''}
          </span>
          <span class="popup-plato-nombre">${UI.escapeHtml(p.nombre)}</span>
        </div>
        <span class="popup-plato-meta">${(p.etiquetas||[]).slice(0,2).map(e=>`<span class="pl-etiqueta">${UI.escapeHtml(e)}</span>`).join('')}</span>
      </button>`).join('');
  }

  function _bindPopupPlatos(fecha, momento, perfil, modal, arr, container){
    // Eliminar plato de selección actual
    container.querySelectorAll('[data-rm-idx]').forEach(btn=>{
      btn.addEventListener('click',(e)=>{
        e.stopPropagation();
        const idx = parseInt(btn.dataset.rmIdx);
        const dia = _menuEnCurso.dias.find(d=>d.fecha===fecha);
        if(!dia) return;
        const platosArr = dia[momento][arr] || [];
        platosArr.splice(idx,1);
        dia[momento][arr] = platosArr;
        // Actualiza selección actual en el popup
        const selEl = document.getElementById('popup-seleccion-actual');
        if(selEl) selEl.innerHTML = _buildSeleccionActual(platosArr);
        _actualizarCeldaCalendario(fecha, momento, perfil, platosArr);
        // Re-bind
        _bindPopupPlatos(fecha, momento, perfil, modal, arr, container);
      });
    });

    // Seleccionar plato
    document.querySelectorAll('.popup-plato-item').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const dia = _menuEnCurso.dias.find(d=>d.fecha===fecha);
        if(!dia) return;
        const platosArr = dia[momento][arr] || [];
        const tipo = btn.dataset.tipo;
        const nuevoPlato = {id:btn.dataset.id, nombre:btn.dataset.nombre};
        const esCenaAdulto = momento==='cena' && perfil==='mayores';

        if(esCenaAdulto || tipo==='unico') {
          // Reemplaza todo
          dia[momento][arr] = [nuevoPlato];
          _actualizarCeldaCalendario(fecha, momento, perfil, [nuevoPlato]);
          modal.close();
        } else if(tipo==='primero') {
          // Pone como primero, mantiene segundo si había
          const segundoExistente = platosArr.find(p=>{
            const db=(App.getState().platos||[]).find(pl=>pl.id===p.id);
            return db?.tipoPlato==='segundo';
          });
          const nuevos = segundoExistente ? [nuevoPlato, segundoExistente] : [nuevoPlato];
          dia[momento][arr] = nuevos;
          _actualizarCeldaCalendario(fecha, momento, perfil, nuevos);
          // No cierra el modal — permite añadir segundo
          const selEl = document.getElementById('popup-seleccion-actual');
          if(selEl) selEl.innerHTML = _buildSeleccionActual(nuevos);
          _bindPopupPlatos(fecha, momento, perfil, modal, arr, container);
        } else if(tipo==='segundo') {
          // Añade como segundo, mantiene primero
          const primeroExistente = platosArr.find(p=>{
            const db=(App.getState().platos||[]).find(pl=>pl.id===p.id);
            return db?.tipoPlato==='primero';
          });
          const nuevos = primeroExistente ? [primeroExistente, nuevoPlato] : [nuevoPlato];
          dia[momento][arr] = nuevos;
          _actualizarCeldaCalendario(fecha, momento, perfil, nuevos);
          modal.close();
        }
      });
    });
  }

  function _actualizarCeldaCalendario(fecha, momento, perfil, platos) {
    const celda = document.querySelector(
      `.menu-cal-celda--edit[data-fecha="${fecha}"][data-momento="${momento}"][data-perfil="${perfil}"]`
    );
    if(celda) celda.textContent = platos.map(p=>p.nombre).join(' + ') || '+';
  }

  // _asignarPlato queda como alias simple para compatibilidad
  function _asignarPlato(fecha, momento, perfil, platoId, platoNombre){
    const dia=_menuEnCurso.dias.find(d=>d.fecha===fecha);
    if(!dia) return;
    const arr=perfil==='bebe'?'platosBebe':'platosMayores';
    if(!dia[momento][arr]) dia[momento][arr]=[];
    dia[momento][arr]=[{id:platoId,nombre:platoNombre}];
    _actualizarCeldaCalendario(fecha, momento, perfil, [{id:platoId,nombre:platoNombre}]);
  }

  // ── Bind eventos ─────────────────────────────────────────────────

  function _bindPasoEvents(){
    switch(_paso){
      case 1:_bindPaso1();break;
      case 2:_bindPaso2();break;
      case 3:_bindPaso3();break;
      case 5:_bindPaso5();break;
    }
  }

  function _bindPaso1(){
    // Datepicker propio
    document.getElementById('menu-fecha-btn')?.addEventListener('click',()=>{
      Dates.openDatepicker(_menuEnCurso.fechaInicio, Dates.today(), (iso)=>{
        _menuEnCurso.fechaInicio=iso;
        _menuEnCurso.fechaFin=Dates.addDays(iso,_menuEnCurso.numSemanas*7-1);
        const btn=document.getElementById('menu-fecha-btn');
        if(btn) btn.textContent=`📅 ${Dates.format(iso,'long')}`;
      });
    });
    document.getElementById('menu-semanas-plus')?.addEventListener('click',()=>{
      _menuEnCurso.numSemanas=Math.min(8,_menuEnCurso.numSemanas+1);
      const el=document.getElementById('menu-semanas-val');
      if(el) el.textContent=_menuEnCurso.numSemanas;
    });
    document.getElementById('menu-semanas-minus')?.addEventListener('click',()=>{
      _menuEnCurso.numSemanas=Math.max(1,_menuEnCurso.numSemanas-1);
      const el=document.getElementById('menu-semanas-val');
      if(el) el.textContent=_menuEnCurso.numSemanas;
    });
    document.getElementById('menu-paso1-next')?.addEventListener('click',()=>{
      _menuEnCurso.fechaFin=Dates.addDays(_menuEnCurso.fechaInicio,_menuEnCurso.numSemanas*7-1);
      _paso=2;_renderAsistente();
    });
  }

  function _bindPaso2(){
    document.getElementById('menu-paso2-next')?.addEventListener('click',()=>{
      _menuEnCurso.dias=[];
      document.querySelectorAll('.menu-dia-esp-select').forEach(sel=>{
        if(sel.value) _menuEnCurso.dias.push({fecha:sel.dataset.fecha,tipoEspecial:sel.value});
      });
      _paso=3;_renderAsistente();
    });
  }

  function _bindPaso3(){
    document.getElementById('menu-paso3-next')?.addEventListener('click',()=>{_paso=4;_renderAsistente();});
    document.getElementById('menu-paso3-skip')?.addEventListener('click',()=>{_paso=4;_renderAsistente();});
    document.querySelectorAll('.menu-toggle-forzar').forEach(btn=>{
      btn.addEventListener('click',async()=>{
        const id=btn.dataset.id;
        const inv=[...(App.getState().inventario||[])];
        const idx=inv.findIndex(i=>i.id===id);
        if(idx===-1) return;
        inv[idx]={...inv[idx],forzarUso:!inv[idx].forzarUso};
        await App.setState('inventario',inv);
        btn.style.background=inv[idx].forzarUso?'var(--color-primary-light)':'';
        btn.style.color=inv[idx].forzarUso?'var(--color-primary)':'';
        btn.textContent=inv[idx].forzarUso?'⭐ Forzado':'⭐ Usar';
      });
    });
  }

  function _bindPaso5(){
    document.querySelectorAll('.menu-cal-celda--edit').forEach(td=>{
      td.addEventListener('click',()=>{
        _abrirPopupPlato(td.dataset.fecha,td.dataset.momento,td.dataset.perfil);
      });
    });
    document.getElementById('menu-btn-confirmar')?.addEventListener('click',_confirmarMenu);
    const panelBtn=document.getElementById('menu-panel-inv-btn');
    const panelEl=document.getElementById('menu-panel-inv');
    panelBtn?.addEventListener('click',()=>{
      if(panelEl.classList.contains('hidden')){
        const inv=App.getState().inventario||[];
        panelEl.innerHTML=`<div class="menu-panel-content"><h3 class="section-title" style="margin-bottom:var(--space-3)">📦 Despensa</h3>
          ${inv.length===0?'<p class="text-sm text-muted">Vacía.</p>':
            inv.map(i=>`<div class="menu-panel-item"><span>${UI.escapeHtml(i.nombre)}</span>
              <span class="text-xs text-muted">${i.cantidad} ${i.unidad} · ${i.ubicacion}</span></div>`).join('')}
        </div>`;
        panelEl.classList.remove('hidden');
        panelBtn.textContent='📦 Ocultar';
      }else{ panelEl.classList.add('hidden'); panelBtn.textContent='📦 Despensa'; }
    });
  }

  function _ensureView(){
    if(!document.getElementById('view-menu')){
      const v=document.createElement('div');
      v.id='view-menu';v.className='view';
      document.getElementById('app-content')?.appendChild(v);
    }
  }

  // ── KPIs nutricionales ───────────────────────────────────────────

  function _mostrarKPIs(diasCombinados) {
    const state   = App.getState();
    const platosDB= state.platos || [];

    // Referencias OMS por semana (7 días, 2 comidas principales)
    const REFS = [
      { grupo:'verdura',      label:'🥦 Verdura',      etiquetas:['verdura','ensalada'],               minSem:7,  maxSem:14, color:'#22c55e' },
      { grupo:'legumbre',     label:'🫘 Legumbre',      etiquetas:['legumbre'],                         minSem:3,  maxSem:4,  color:'#f59e0b' },
      { grupo:'pescado',      label:'🐟 Pescado',       etiquetas:['pescado-blanco','pescado-azul'],     minSem:3,  maxSem:4,  color:'#3b82f6' },
      { grupo:'pescado-azul', label:'🐠 Pescado azul',  etiquetas:['pescado-azul'],                     minSem:1,  maxSem:2,  color:'#6366f1' },
      { grupo:'carne',        label:'🍗 Carne',         etiquetas:['carne-ave','carne-roja'],            minSem:2,  maxSem:3,  color:'#ef4444' },
      { grupo:'carne-roja',   label:'🥩 Carne roja',   etiquetas:['carne-roja'],                       minSem:0,  maxSem:1,  color:'#dc2626' },
      { grupo:'huevo',        label:'🥚 Huevo',         etiquetas:['huevo'],                            minSem:3,  maxSem:4,  color:'#eab308' },
      { grupo:'hidratos',     label:'🍞 Hidratos',      etiquetas:['hidratos'],                          minSem:3,  maxSem:7,  color:'#a78bfa' },
    ];

    // Agrupa días por semana ISO
    const semanas = _agruparPorSemana(diasCombinados);

    // Calcula conteos por semana y grupo
    function contarGrupo(diasSemana, etiquetas) {
      let count = 0;
      diasSemana.forEach(d => {
        ['comida','cena'].forEach(m => {
          const bloque = d[m];
          if(!bloque?.activo) return;
          const todos = [...(bloque.platosMayores||[])];
          const idsUnicos = [...new Set(todos.map(p=>p.id))];
          idsUnicos.forEach(id => {
            const plato = platosDB.find(p=>p.id===id);
            if(!plato) return;
            const etqs = (plato.etiquetas||[]).map(e=>e.toLowerCase());
            if(etiquetas.some(e=>etqs.includes(e))) count++;
          });
        });
      });
      return count;
    }

    const container = document.createElement('div');

    let html = `
      <p class="text-sm text-muted" style="margin-bottom:var(--space-5)">
        Comparativa semanal de la programación actual frente a las recomendaciones alimenticias.
        Basado en los platos de adultos con etiquetas de grupo.
      </p>`;

    semanas.forEach((diasSem, si) => {
      const lunes = diasSem[0].fecha;
      const dom   = diasSem[diasSem.length-1].fecha;
      html += `<div style="margin-bottom:var(--space-6)">
        <h3 style="font-size:var(--font-size-sm);font-weight:700;margin-bottom:var(--space-3);color:var(--color-text-secondary)">
          Semana ${si+1} — ${Dates.format(lunes,'numshort')} al ${Dates.format(dom,'numshort')}
        </h3>`;

      REFS.forEach(ref => {
        const count   = contarGrupo(diasSem, ref.etiquetas);
        const pct     = ref.maxSem > 0 ? Math.min(100, Math.round(count/ref.maxSem*100)) : 0;
        const enRango = count >= ref.minSem && count <= ref.maxSem;
        const sobrante= count > ref.maxSem;
        const color   = sobrante ? '#ef4444' : enRango ? '#22c55e' : ref.color;
        const estado  = sobrante ? '⚠ exceso' : enRango ? '✓ ok' : (ref.minSem===0&&count===0)?'✓ ok':'↓ bajo';

        html += `
          <div style="margin-bottom:var(--space-4)">
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
              <span style="font-size:var(--font-size-sm);font-weight:700">${ref.label}</span>
              <span style="font-size:var(--font-size-xs);color:${color};font-weight:700;text-align:right;white-space:nowrap;margin-left:var(--space-3)">
                ${count}×sem &nbsp;·&nbsp; recom. ${ref.minSem}–${ref.maxSem} &nbsp; ${estado}
              </span>
            </div>
            <div style="height:12px;background:var(--color-border);border-radius:var(--radius-full);overflow:hidden;position:relative">
              <div style="height:100%;width:${pct}%;background:${color};border-radius:var(--radius-full);transition:width .4s ease;min-width:${count>0?'8px':'0'}"></div>
              ${ref.minSem > 0 ? `<div style="position:absolute;top:0;bottom:0;left:${Math.min(100,Math.round(ref.minSem/ref.maxSem*100))}%;width:2px;background:rgba(0,0,0,.2)"></div>` : ''}
            </div>
            <div style="display:flex;justify-content:flex-end;margin-top:2px">
              <span style="font-size:9px;color:var(--color-text-muted)">óptimo: ${ref.minSem}–${ref.maxSem}×sem</span>
            </div>
          </div>`;
      });

      html += `</div>`;
    });

    if(!semanas.length) {
      html += '<p class="text-sm text-muted">No hay menú generado para analizar.</p>';
    }

    html += `
      <div style="background:var(--color-surface-2);border-radius:var(--radius-md);padding:var(--space-4);margin-top:var(--space-4)">
        <p class="text-xs text-muted"><strong>Nota:</strong> El análisis usa las etiquetas de grupo asignadas a cada plato
        (verdura, legumbre, pescado-blanco, pescado-azul, carne-ave, carne-roja, huevo, hidratos, ensalada).
        Si un plato no tiene etiquetas, no se contabiliza. Puedes editarlas en el catálogo de platos.</p>
      </div>`;

    container.innerHTML = html;
    UI.showModal({ title:'📊 Equilibrio nutricional semanal', content: container });
  }

  return { render, getCalendarioHTML };

})();
