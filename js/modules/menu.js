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
    'legumbre':      { min: 3, max: 4, etiquetas: ['legumbre'] },
    'pescado':       { min: 3, max: 4, etiquetas: ['pescado-blanco','pescado-azul'] },
    'pescado-azul':  { min: 1, max: 2, etiquetas: ['pescado-azul'] },  // del total de pescado
    'carne':         { min: 2, max: 3, etiquetas: ['carne-ave','carne-roja'] },
    'carne-roja':    { min: 0, max: 1, etiquetas: ['carne-roja'] },    // max 1/semana
    'huevo':         { min: 3, max: 4, etiquetas: ['huevo'] },
    'verdura':       { min: 7, max: 99, etiquetas: ['verdura','ensalada'] }, // todos los días
  };

  const ETIQUETAS_PROTEINA = {
    carne:   ['carne','pollo','cerdo','ternera','pavo','cordero'],
    pescado: ['pescado','marisco','merluza','lubina','salmón','atún','bacalao'],
    legumbre:['legumbre','garbanzos','lentejas','alubias','judías'],
    huevo:   ['huevo','tortilla','revuelto'],
    pasta:   ['pasta','macarrones','espagueti','fideos','arroz'],
  };

  // ── API pública ──────────────────────────────────────────────────

  function render() {
    _ensureView();
    _paso = 0;
    _renderVista();
  }

  /** Devuelve el HTML del calendario para usarlo en otros contextos (dashboard) */
  async function getCalendarioHTML() {
    const hoy = Dates.today();
    const menusEnDrive = await Drive.listMenuFiles().catch(()=>[]);
    const todosMenus = [];
    for (const f of menusEnDrive) {
      try { const m=await Drive.readMenuJson(f.id); if(m) todosMenus.push(m); } catch{}
    }
    const diasCombinados = _combinarDiasDeMenus(todosMenus);
    if (!diasCombinados.length) return null;
    const config = App.getState().config||{};
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
           </div>`
        : `<div class="card card-empty">
             <div class="empty-state-icon">📅</div>
             <p>No hay menú generado todavía.</p>
             <button class="btn btn-primary" id="menu-btn-nuevo2">Generar primer menú</button>
           </div>`}`;

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
    const usadosBebe     = new Set();
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
          const cands = _filtrarMayores({
            platos:platosActivos, momento:'comida',
            usadosSemana, usadosReciente, artsPrioritarios,
            protPorDia, diaIndex:di, esCena:false, cfgMenus,
            soloFacil: dia.facilComida, contadorGrupos,
          });
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
          blComida.platosBebe = _generarBloqueBebeComida(
            blComida.platosMayores, platosActivos,
            usadosBebe, usadosReciente, artsPrioritarios,
            sobrasBebe, cfgMenus, dia.facilComida, inventario||[]
          );
        }
      }

      // ── CENA ────────────────────────────────────────────────────
      const blCena = dia.cena;
      if(blCena.activo){

        // 1. Adultos cena — siempre plato único
        if(blCena._mayActivo){
          const cands = _filtrarMayores({
            platos:platosActivos, momento:'cena',
            usadosSemana, usadosReciente, artsPrioritarios,
            protPorDia, diaIndex:di, esCena:true, cfgMenus,
            forzarUnico:true, soloFacil: dia.facilCena, contadorGrupos,
          });
          const p = _elegirPlato(cands, [...artsPrioritarios], inventario||[]);
          if(p){
            blCena.platosMayores = [{id:p.id,nombre:p.nombre}];
            _registrarMayor(usadosSemana, p.id, di);
            _registrarProteina(protPorDia, di, p);
            _registrarGrupo(contadorGrupos, p);
          }
        }

        // 2. Bebé cena
        if(tieneBebe && blCena._bebeActivo){
          blCena.platosBebe = _generarBloqueBebeConSobras(
            blCena.platosMayores, platosActivos,
            usadosBebe, usadosReciente, artsPrioritarios,
            sobrasBebe, cfgMenus, dia.facilCena, 'cena', inventario||[]
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
    usadosSemana.get(id).push(diaIndex);
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
  function _generarBloqueBebeComida(platosAdultos, platosActivos, usadosBebe,
    usadosReciente, artsPrioritarios, sobrasBebe, cfgMenus, soloFacil, inventario) {

    // Platos de adultos que son compatibles con bebé
    const compatAdultos = (platosAdultos||[]).filter(pa => {
      const db = platosActivos.find(p => p.id === pa.id);
      return db && (db.tipoMenu.includes('todos') || db.tipoMenu.includes('bebe'));
    });

    if(compatAdultos.length > 0){
      // Bebé come lo mismo que adultos — asegurar que tenga primero+segundo si toca
      return _asegurarPrimeroSegundo(compatAdultos, platosActivos, usadosBebe, usadosReciente, 'comida');
    }

    // Sobras disponibles
    const sobra = _elegirDeSobras(sobrasBebe, platosActivos);
    if(sobra){
      sobrasBebe[sobra.id]--;
      if(sobrasBebe[sobra.id] <= 0) delete sobrasBebe[sobra.id];
      return _completarPrimeroSegundo([{id:sobra.id,nombre:sobra.nombre}],
        platosActivos, sobra, usadosBebe, usadosReciente, 'comida');
    }

    // Plato propio de bebé
    const cands = _filtrarCandidatosBebe(platosActivos, 'comida', usadosBebe, usadosReciente);
    const p = _elegirPlato(cands, [...artsPrioritarios], inventario);
    if(p){
      usadosBebe.add(p.id);
      if((p.diasSobras||0) > 0) sobrasBebe[p.id] = (sobrasBebe[p.id]||0) + p.diasSobras;
      return _completarPrimeroSegundo([{id:p.id,nombre:p.nombre}],
        platosActivos, p, usadosBebe, usadosReciente, 'comida');
    }

    return compatAdultos.length ? compatAdultos : (platosAdultos||[]);
  }

  /**
   * Genera el bloque de bebé para la CENA.
   * Prioridad: sobras → compat adultos → plato propio.
   */
  function _generarBloqueBebeConSobras(platosAdultos, platosActivos, usadosBebe,
    usadosReciente, artsPrioritarios, sobrasBebe, cfgMenus, soloFacil, momento, inventario) {

    // Sobras primero en cena
    const sobra = _elegirDeSobras(sobrasBebe, platosActivos);
    if(sobra){
      sobrasBebe[sobra.id]--;
      if(sobrasBebe[sobra.id] <= 0) delete sobrasBebe[sobra.id];
      return _completarPrimeroSegundo([{id:sobra.id,nombre:sobra.nombre}],
        platosActivos, sobra, usadosBebe, usadosReciente, momento);
    }

    // ¿Plato de adultos compatible con bebé?
    const platoCenaAd = (platosAdultos||[])[0];
    const dbCenaAd = platoCenaAd
      ? platosActivos.find(p => p.id===platoCenaAd.id &&
          (p.tipoMenu.includes('todos') || p.tipoMenu.includes('bebe')))
      : null;
    if(dbCenaAd){
      return _completarPrimeroSegundo([{id:dbCenaAd.id,nombre:dbCenaAd.nombre}],
        platosActivos, dbCenaAd, usadosBebe, usadosReciente, momento);
    }

    // Plato propio de bebé
    const cands = _filtrarCandidatosBebe(platosActivos, momento, usadosBebe, usadosReciente);
    const p = _elegirPlato(cands, [...artsPrioritarios], inventario);
    if(p){
      usadosBebe.add(p.id);
      return _completarPrimeroSegundo([{id:p.id,nombre:p.nombre}],
        platosActivos, p, usadosBebe, usadosReciente, momento);
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
      if(!p.permiteRepeticion && usadosBebe.has(p.id)) return false;
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
    if(!platoObjeto) return platosRef;
    if(platoObjeto.tipoPlato === 'unico') return platosRef;
    if(platoObjeto.tipoPlato === 'segundo'){
      // Caso raro: solo tenemos un segundo, buscamos un primero
      const primero = _elegirPrimeroBebe(platosActivos, usadosBebe, usadosReciente, momento);
      if(primero){ usadosBebe.add(primero.id); return [{id:primero.id,nombre:primero.nombre}, ...platosRef]; }
      return platosRef;
    }
    // tipoPlato === 'primero': busca segundo
    const segundo = _elegirSegundoBebe(platosActivos, usadosBebe, usadosReciente, momento);
    if(segundo){ usadosBebe.add(segundo.id); return [...platosRef, {id:segundo.id,nombre:segundo.nombre}]; }
    return platosRef;
  }

  /**
   * Dado array de platos de adultos compatibles con bebé,
   * asegura que el bebé tenga primero+segundo si el primero no es único.
   */
  function _asegurarPrimeroSegundo(compatAdultos, platosActivos, usadosBebe, usadosReciente, momento) {
    if(compatAdultos.length >= 2) return compatAdultos;  // ya tiene dos
    const primerRef = compatAdultos[0];
    if(!primerRef) return [];
    const primerDB = platosActivos.find(p => p.id === primerRef.id);
    if(!primerDB || primerDB.tipoPlato === 'unico') return compatAdultos;
    // Necesita segundo
    const segundo = _elegirSegundoBebe(platosActivos, usadosBebe, usadosReciente, momento);
    if(segundo){ usadosBebe.add(segundo.id); return [...compatAdultos, {id:segundo.id,nombre:segundo.nombre}]; }
    return compatAdultos;
  }

  function _elegirPrimeroBebe(platosActivos, usadosBebe, usadosReciente, momento) {
    const cands = platosActivos.filter(p => {
      if(!p.tipoMenu?.includes('bebe') && !p.tipoMenu?.includes('todos')) return false;
      if(p.tipoPlato !== 'primero') return false;
      if(!p.tipoComida?.includes(momento) && !p.tipoComida?.includes('ambos')) return false;
      if(!p.permiteRepeticion && usadosBebe.has(p.id)) return false;
      return true;
    });
    if(!cands.length) return null;
    return cands[Math.floor(Math.random() * cands.length)];
  }

  function _elegirSegundoBebe(platosActivos, usadosBebe, usadosReciente, momento) {
    const cands = platosActivos.filter(p => {
      if(p.tipoPlato !== 'segundo') return false;
      if(!p.tipoMenu?.includes('bebe') && !p.tipoMenu?.includes('todos')) return false;
      if(!p.tipoComida?.includes(momento) && !p.tipoComida?.includes('ambos')) return false;
      if(!p.permiteRepeticion && usadosBebe.has(p.id)) return false;
      return true;
    });
    if(!cands.length) return null;
    return cands[Math.floor(Math.random() * cands.length)];
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

  function _abrirPopupPlato(fecha,momento,perfil){
    const state=App.getState();
    const platosActivos=(state.platos||[]).filter(p=>p.activo!==false);
    const compatibles=platosActivos.filter(p=>{
      const mOk=p.tipoComida?.includes(momento)||p.tipoComida?.includes('ambos');
      const pOk=perfil==='bebe'
        ? p.tipoMenu?.includes('bebe')||p.tipoMenu?.includes('todos')
        : p.tipoMenu?.includes('mayores')||p.tipoMenu?.includes('todos');
      return mOk&&pOk;
    });

    const container=document.createElement('div');
    container.innerHTML=`
      <div class="search-bar" style="margin-bottom:var(--space-3)">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input type="search" id="popup-plato-search" placeholder="Buscar..." autocomplete="off"/>
      </div>
      <div id="popup-plato-list" class="popup-plato-list">${_buildPopupPlatos(compatibles,'')}</div>`;

    const modal=UI.showModal({
      title:`${momento==='comida'?'🍽 Comida':'🌙 Cena'} · ${perfil==='bebe'?'Bebé':'Adultos'}`,
      content:container,
    });
    setTimeout(()=>{
      const inp=document.getElementById('popup-plato-search');
      inp?.focus();
      inp?.addEventListener('input',e=>{
        const f=e.target.value.toLowerCase();
        const list=document.getElementById('popup-plato-list');
        if(list) list.innerHTML=_buildPopupPlatos(compatibles,f);
        _bindPopupPlatos(fecha,momento,perfil,modal);
      });
      _bindPopupPlatos(fecha,momento,perfil,modal);
    },100);
  }

  function _buildPopupPlatos(platos,filtro){
    const f=filtro?platos.filter(p=>p.nombre.toLowerCase().includes(filtro)):platos;
    if(!f.length) return `<p class="text-sm text-muted" style="padding:var(--space-4)">Sin resultados.</p>`;
    return f.sort((a,b)=>a.nombre.localeCompare(b.nombre,'es')).map(p=>`
      <button class="popup-plato-item" data-id="${p.id}" data-nombre="${UI.escapeHtml(p.nombre)}">
        <span class="popup-plato-nombre">${UI.escapeHtml(p.nombre)}</span>
        <span class="popup-plato-meta">${(p.etiquetas||[]).slice(0,3).map(e=>`<span class="pl-etiqueta">${UI.escapeHtml(e)}</span>`).join('')}</span>
      </button>`).join('');
  }

  function _bindPopupPlatos(fecha,momento,perfil,modal){
    document.querySelectorAll('.popup-plato-item').forEach(btn=>{
      btn.addEventListener('click',()=>{
        _asignarPlato(fecha,momento,perfil,btn.dataset.id,btn.dataset.nombre);
        modal.close();
      });
    });
  }

  function _asignarPlato(fecha,momento,perfil,platoId,platoNombre){
    const dia=_menuEnCurso.dias.find(d=>d.fecha===fecha);
    if(!dia) return;
    const arr=perfil==='bebe'?'platosBebe':'platosMayores';
    if(!dia[momento][arr]) dia[momento][arr]=[];
    dia[momento][arr]=[{id:platoId,nombre:platoNombre}];
    const celda=document.querySelector(
      `.menu-cal-celda--edit[data-fecha="${fecha}"][data-momento="${momento}"][data-perfil="${perfil}"]`
    );
    if(celda) celda.textContent=platoNombre;
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

  return { render, getCalendarioHTML };

})();
