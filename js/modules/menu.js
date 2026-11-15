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
  let _edicion = null;
  let _guardando = false;
  let _cargaVista = 0;

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
    _edicion = null;
    _renderVista();
  }

  /** Devuelve el HTML del calendario para usarlo en el dashboard.
   *  Usa el menuActual del estado si está disponible para evitar llamadas a Drive. */
  /** Devuelve el HTML del calendario para el DASHBOARD — solo semana actual */
  async function getCalendarioHTML() {
    const state = App.getState();
    let todosMenus = [];

    if (state.menuActual) {
      todosMenus = [state.menuActual];
    } else {
      try {
        const timeoutPromise = new Promise((_,rej) => setTimeout(()=>rej(new Error('timeout')),5000));
        const drivePromise = Drive.listMenuFiles().catch(()=>[]);
        const menusEnDrive = await Promise.race([drivePromise, timeoutPromise]).catch(()=>[]);
        for (const f of menusEnDrive.slice(0,3)) {
          try { const m=await Drive.readMenuJson(f.id); if(m) todosMenus.push(m); } catch{}
        }
      } catch { todosMenus = []; }
    }

    const todosDias = _combinarDiasDeMenus(todosMenus);
    if (!todosDias.length) return null;

    // Solo semana actual para el dashboard (lun-dom usando Dates.startOfWeek)
    const hoy      = Dates.today();
    const lunesStr = Dates.startOfWeek(hoy);           // lunes de esta semana
    const domStr   = Dates.addDays(lunesStr, 6);       // domingo de esta semana

    const diasSemana = todosDias.filter(d => d.fecha >= lunesStr && d.fecha <= domStr);
    if (!diasSemana.length) return null;

    const config    = state.config||{};
    const tieneBebe = (config.personas||[]).some(p=>p.tipo==='bebe');
    return _buildCalendario(diasSemana, tieneBebe);
  }

  // ── Vista principal ──────────────────────────────────────────────

  async function _renderVista() {
    const view = document.getElementById('view-menu');
    if (!view) return;
    view.innerHTML = `<div class="loading-container" style="padding:var(--space-8) 0">
      <div class="loading-spinner"></div><p class="loading-message">Cargando menús...</p></div>`;

    const carga = ++_cargaVista;
    const hoy = Dates.today();
    const menusEnDrive = await Drive.listMenuFiles().catch(()=>[]);
    const todosMenus = [];
    for (const f of menusEnDrive) {
      try { const m=await Drive.readMenuJson(f.id); if(m) todosMenus.push({ ...m, _fileId: f.id, _fileName: f.name }); } catch{}
    }
    if (carga !== _cargaVista || _paso !== 0) return;
    const menuActivo = todosMenus
      .filter(m => m.fechaInicio<=hoy&&m.fechaFin>=hoy&&m.estado!=='historico'&&m.estado!=='borrador')
      .sort((a,b) => (b.confirmadoEn||b.generadoEn||'').localeCompare(a.confirmadoEn||a.generadoEn||''))[0];
    const lunes = Dates.startOfWeek(hoy);
    const menusVisibles = todosMenus.filter(m => m.estado !== 'borrador' && m.estado !== 'historico' && m.fechaFin >= lunes)
      .sort((a,b) => a.fechaInicio.localeCompare(b.fechaInicio));
    const diasPlanificados = _combinarDiasDeMenus(menusVisibles).filter(d => d.fecha >= lunes);
    const diasCombinados = _incluirSemanaActual(diasPlanificados, hoy);
    const config = App.getState().config||{};
    const tieneBebe = (config.personas||[]).some(p=>p.tipo==='bebe');
    App.getState().menuActual = menuActivo||null;

    view.innerHTML = `
      <div class="module-header">
        <h1 class="module-title">Menú</h1>
        <div style="display:flex;gap:var(--space-2)">
          <button class="btn btn-secondary btn-sm" id="menu-btn-historial">Historial</button>
          <button class="btn btn-primary btn-sm" id="menu-btn-nuevo">+ Nuevo</button>
        </div>
      </div>
      ${menusVisibles.length ? `<div class="menu-edicion-selector">
        <label for="menu-editar-seleccion">Menú que quieres editar</label>
        <select id="menu-editar-seleccion" class="form-control">
          ${menusVisibles.map((m,i) => `<option value="${i}" ${m === menuActivo ? 'selected' : ''}>Del ${Dates.format(m.fechaInicio,'short')} al ${Dates.format(m.fechaFin,'short')}</option>`).join('')}
        </select>
        <button class="btn btn-secondary btn-full" id="menu-btn-editar">✏️ Editar menú seleccionado</button>
      </div>` : ''}
      <div class="menu-calendario-wrapper">${_buildCalendario(diasCombinados,tieneBebe)}</div>
           <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4)">
             ${menuActivo
               ? `<button class="btn btn-primary btn-full" id="menu-btn-compra">🛒 Compra</button>`
               : `<button class="btn btn-primary btn-full" id="menu-btn-nuevo2">Generar menú de esta semana</button>`}
           </div>
           <div style="margin-top:var(--space-3)">
             <button class="btn btn-secondary btn-full" id="menu-btn-kpi">📊 Ver equilibrio nutricional</button>
           </div>`;

    document.getElementById('menu-btn-historial')?.addEventListener('click',()=>App.navigate('historial'));
    document.getElementById('menu-btn-kpi')?.addEventListener('click', ()=>_mostrarKPIs(diasPlanificados));
    document.getElementById('menu-btn-nuevo')?.addEventListener('click',_iniciarAsistente);
    document.getElementById('menu-btn-nuevo2')?.addEventListener('click',_iniciarAsistente);
    document.getElementById('menu-btn-editar')?.addEventListener('click',()=>{
      const seleccionado = menusVisibles[Number(document.getElementById('menu-editar-seleccion').value)];
      if (seleccionado) editar(seleccionado);
    });
    document.getElementById('menu-btn-compra')?.addEventListener('click',()=>App.navigate('compra'));
    requestAnimationFrame(_scrollCalendarioAHoy);
  }

  /** Abre una copia editable del menú y conserva su archivo y vista de origen. */
  function editar(menu, origen = 'menu') {
    if (_guardando) return;
    _cargaVista++;
    _menuEnCurso = JSON.parse(JSON.stringify(menu));
    delete _menuEnCurso._fileId;
    delete _menuEnCurso._fileName;
    _edicion = { fileId: menu._fileId, fileName: menu._fileName, origen, original: menu };
    UI.activateView('menu');
    _paso = 5;
    _renderAsistente();
  }

  // ── Scroll al lunes de semana actual ────────────────────────────

  function _scrollCalendarioAHoy() {
    const scroll = document.querySelector('#view-menu.active .menu-cal-scroll');
    if (!scroll) return;

    // Usa Dates.startOfWeek igual que el filtro de la home
    const lunesStr = Dates.startOfWeek(Dates.today());

    const todasCols = [...scroll.querySelectorAll('.menu-cal-col[data-fecha]')];
    if (!todasCols.length) return;

    // Primera columna cuya fecha sea >= lunes de esta semana
    const targetCol = todasCols.find(c => c.dataset.fecha >= lunesStr)
                   || todasCols[todasCols.length - 1];
    if (!targetCol) return;

    const posicion = targetCol.getBoundingClientRect().left - scroll.getBoundingClientRect().left;
    scroll.scrollLeft += posicion;
  }

  // ── Combinar días ────────────────────────────────────────────────

  function _incluirSemanaActual(dias, hoy) {
    const porFecha = new Map(dias.map(dia => [dia.fecha, dia]));
    for (const fecha of Dates.range(Dates.startOfWeek(hoy), 7)) {
      if (!porFecha.has(fecha)) porFecha.set(fecha, {
        fecha, diaSemana: Dates.dayName(fecha),
        comida: { activo: false }, cena: { activo: false },
      });
    }
    return [...porFecha.values()].sort((a,b)=>a.fecha.localeCompare(b.fecha));
  }

  function _combinarDiasDeMenus(menus) {
    const porFecha={};
    menus.forEach(m=>{
      (m.dias||[]).forEach(d=>{
        const ex=porFecha[d.fecha];
        const version=m.confirmadoEn||m.generadoEn||'';
        if(!ex||version>(ex._gen||''))
          porFecha[d.fecha]={...d,_gen:version};
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
                    data-fecha="${dia.fecha}"
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
          const plMay=bloque?.activo&&bloque._mayActivo!==false&&bloque.platosMayores?.length
            ? bloque.platosMayores.map(p=>p.nombre).join(' + ')
            : (bloque?.activo===false||bloque?._mayActivo===false||!bloque?'—':'–');
          const esEsp=!bloque?.activo||bloque._mayActivo===false;
          html+=`<div class="menu-cal-celda ${esEsp?'menu-cal-celda--esp':''}"
                      style="height:${ALT_FILA}px">${UI.escapeHtml(plMay)}</div>`;
          // Bebé
          if(tieneBebe){
            const bebeInactivo=!bloque?.activo||bloque._bebeActivo===false||bloque.platosBebe===null;
            const plBebe=!bebeInactivo&&bloque.platosBebe?.length
              ? bloque.platosBebe.map(p=>p.nombre).join(' + ')
              : (bebeInactivo?'—':'–');
            html+=`<div class="menu-cal-celda menu-cal-celda--bebe ${bebeInactivo?'menu-cal-celda--esp':''}"
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
                    data-fecha="${dia.fecha}"
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
          const esCancelado = bloque?.activo===false && !!dia.tipoEspecial;
          const mayorCancelado = esCancelado || bloque?._mayActivo===false || !bloque?.activo;
          const bebeCancelado = esCancelado || bloque?._bebeActivo===false;

          // Adultos editable
          const plMay=!mayorCancelado&&bloque?.platosMayores?.length
            ? bloque.platosMayores.map(p=>p.nombre).join(' + ') : '+';
          const etiquetaMayor=mayorCancelado?'Marcado fuera; pulsa para añadir una excepción':'Editar comida de adultos';
          html+=`<div class="menu-cal-celda menu-cal-celda--edit ${mayorCancelado?'menu-cal-celda--esp':''}"
                      style="height:${ALT_FILA}px"
                      data-fecha="${dia.fecha}" data-momento="${momento}" data-perfil="mayores"
                      aria-label="${UI.escapeHtml(etiquetaMayor)}" title="${UI.escapeHtml(etiquetaMayor)}">${mayorCancelado?'+ Añadir':UI.escapeHtml(plMay)}</div>`;

          // Bebé editable
          if(tieneBebe){
            const plBebe=bloque?.platosBebe?.length
              ? bloque.platosBebe.map(p=>p.nombre).join(' + ') : '+';
            const etiquetaBebe=bloque?.edicionManual?.includes('bebe')
              ? 'Añadido manualmente al menú' : bebeCancelado
                ? 'Marcado fuera; pulsa para añadir una excepción' : 'Editar comida del bebé';
            html+=`<div class="menu-cal-celda menu-cal-celda--bebe menu-cal-celda--edit ${bebeCancelado?'menu-cal-celda--esp':''}"
                        style="height:${ALT_FILA}px"
                        data-fecha="${dia.fecha}" data-momento="${momento}" data-perfil="bebe"
                        aria-label="${UI.escapeHtml(etiquetaBebe)}" title="${UI.escapeHtml(etiquetaBebe)}">${bebeCancelado&&!bloque?.edicionManual?.includes('bebe')?'+ Añadir':UI.escapeHtml(plBebe)}</div>`;
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
    _cargaVista++;
    _edicion = null;
    // La fecha de inicio siempre es el próximo lunes
    const manana = Dates.tomorrow();
    const lunesProximo = Dates.startOfWeek(manana) >= manana
      ? Dates.startOfWeek(manana)
      : Dates.addDays(Dates.startOfWeek(manana), 7);
    // Si mañana ya es lunes, usar mañana directamente
    const inicio = new Date(manana+'T00:00:00').getDay() === 1
      ? manana
      : lunesProximo;

    _menuEnCurso={
      id:`menu-${Date.now()}`,
      fechaInicio: inicio,
      fechaFin: Dates.addDays(inicio, 6),
      numSemanas:1,
      dias:[],
      estado:'borrador',
      generadoEn:null,
      confirmadoEn:null,
      bebeSoloCenasLaborables:false,
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
          <h1 class="module-title" style="flex:1">${_paso<5?`Paso ${_paso} de 4`:_edicion?'Editar menú':'Menú generado'}</h1>
          <button class="btn-text" id="menu-btn-cancelar">Cancelar</button>
        </div>
        ${_paso<5?`<div class="menu-progress">
          ${[1,2,3,4].map(p=>`<div class="menu-progress-step ${p<_paso?'done':p===_paso?'active':''}"></div>${p<4?'<div class="menu-progress-line"></div>':''}`).join('')}
        </div>`:''}
        <div id="menu-paso-content">${_renderPaso()}</div>
      </div>`;
    document.getElementById('menu-btn-back')?.addEventListener('click',()=>{ _paso--;_renderAsistente(); });
    document.getElementById('menu-btn-cancelar')?.addEventListener('click',()=>{
      const origen = _edicion?.origen || 'menu';
      _edicion = null;
      _paso = 0;
      App.navigate(origen);
    });
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
        ${(config.personas||[]).some(p=>p.tipo==='bebe') ? `
          <div class="form-group">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="menu-bebe-solo-cenas" aria-describedby="menu-bebe-solo-cenas-ayuda" ${_menuEnCurso.bebeSoloCenasLaborables?'checked':''}/>
              <span>Bebé: solo cenas de lunes a viernes</span>
            </label>
            <p class="form-hint" id="menu-bebe-solo-cenas-ayuda">Se aplica a todas las semanas de este menú. Sábados y domingos incluyen comida y cena, salvo los días especiales que marques.</p>
          </div>` : ''}
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
    const adaptacion=_menuEnCurso.adaptacionHabitos;
    const usaHabitos=adaptacion && Object.values(adaptacion.semanasObservadas).some(momentos=>Object.values(momentos).some(n=>n>=2));
    return `
      <div class="menu-paso-tabla">
        ${adaptacion ? `<p class="text-sm text-muted" style="margin-bottom:var(--space-3)">${usaHabitos
          ? `Se han priorizado vuestros hábitos de las últimas ${adaptacion.ventanaSemanas} semanas, manteniendo las reglas del catálogo.`
          : 'Todavía no hay dos semanas de histórico suficiente para adaptar las preferencias. Se mantienen las reglas del catálogo.'}</p>` : ''}
        <p class="text-sm" style="margin-bottom:var(--space-3)">Del ${Dates.format(_menuEnCurso.fechaInicio,'long')} al ${Dates.format(_menuEnCurso.fechaFin,'long')}</p>
        <p class="text-sm text-muted" style="margin-bottom:var(--space-3)">Pulsa cualquier celda para cambiar el plato.</p>
        <div class="menu-info-panels">
          <button class="btn btn-secondary btn-sm" id="menu-panel-inv-btn">📦 Despensa</button>
        </div>
        <div id="menu-panel-inv" class="menu-info-panel hidden"></div>
        <div class="menu-calendario-wrapper" style="margin-top:var(--space-3)">
          ${_buildCalendarioEditable(diasCombinados,tieneBebe)}
        </div>
        <div class="menu-paso-footer" style="margin-top:var(--space-6)">
          <button class="btn btn-primary btn-full" id="menu-btn-confirmar">${_edicion ? 'Guardar cambios' : '✓ Confirmar menú'}</button>
        </div>
      </div>`;
  }

  // ── Motor de generación ──────────────────────────────────────────

  async function _generarMenu() {
    const state=App.getState();
    const {platos,inventario,config}=state;
    const platosActivos=(platos||[]).filter(p=>p.activo!==false);
    const horizInicio=_menuEnCurso.fechaInicio;
    const horizFin=Dates.addDays(horizInicio,_menuEnCurso.numSemanas*7-1);
    _setGenMsg('Cargando historial...');
    const hoy=Dates.today();
    const referenciaHabitos=horizInicio<hoy?horizInicio:hoy;
    const semanasHabitos=_semanasHabitos(config?.configuracionMenus?.semanasHistorialHabitos);
    // Las restricciones de repetición conservan su historial aunque se reduzca la ventana de preferencias.
    const historial=await _cargarHistorialReciente(Math.max(6,semanasHabitos),horizInicio,referenciaHabitos);
    const habitos=_construirHabitos(historial, platosActivos, horizInicio, semanasHabitos);
    _setGenMsg('Calculando prioridades...');

    const consumidosAntesDel=_calcularConsumidosAntesDel(historial,horizInicio);
    const artsPrioritarios=new Set();

    (inventario||[]).forEach(item=>{
      const nombre=item.nombre.toLowerCase();
      const stockRestante=(item.cantidad||0)-(consumidosAntesDel[nombre]||0);
      if(stockRestante<=0) return;
      if(item.forzarUso) artsPrioritarios.add(nombre);
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
      const diaSemana = Dates.fromISO(fecha).getDay();
      const soloCenaBebe = _menuEnCurso.bebeSoloCenasLaborables === true && diaSemana>=1 && diaSemana<=5;
      const comidaBebAct = (!tipoEsp?.afectaComida || afectaA==='mayores') && !soloCenaBebe;
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
    const ultimoUsoMayores = new Map(); // conserva consecutivos al cambiar de semana
    const protPorDia     = {};
    const cfgMenus       = config?.configuracionMenus || {};
    const sobrasBebe     = {};         // platoId → días restantes

    const diasHistoricos = _diasHistorial(historial,horizInicio);
    const lunesInicial = Dates.startOfWeek(horizInicio);
    diasHistoricos.forEach(dia => {
      const indice = (Date.parse(dia.fecha)-Date.parse(horizInicio))/86400000;
      ['comida','cena'].forEach(momento => {
        const bloque = dia[momento];
        if(!bloque?.activo) return;
        if(bloque._mayActivo!==false) (bloque.platosMayores||[]).forEach(ref => {
          ultimoUsoMayores.set(ref.id,indice);
          if(dia.fecha>=lunesInicial){
            _registrarMayor(usadosSemana,ref.id,indice);
            const plato = platosActivos.find(p=>p.id===ref.id);
            if(plato) _registrarGrupo(contadorGrupos,plato);
          }
        });
        if(dia.fecha>=lunesInicial && bloque._bebeActivo!==false)
          (bloque.platosBebe||[]).forEach(ref=>usadosBebe.push(ref.id));
      });
    });
    let lunesActual = lunesInicial;
    let usadosReciente = _buildUsadosReciente(historial,horizInicio,'mayores');
    let usadosRecienteBebe = _buildUsadosReciente(historial,horizInicio,'bebe');

    for(let di=0; di<dias.length; di++){
      const dia = dias[di];
      const contexto = (perfil, momento) => ({ modelo: habitos, fecha: dia.fecha, perfil, momento });
      const lunes = Dates.startOfWeek(dia.fecha);
      if(lunes!==lunesActual){
        usadosSemana.clear();
        Object.keys(contadorGrupos).forEach(grupo=>delete contadorGrupos[grupo]);
        usadosBebe.length=0;
        const anteriores = [...historial,{dias:dias.slice(0,di)}];
        usadosReciente = _buildUsadosReciente(anteriores,dia.fecha,'mayores');
        usadosRecienteBebe = _buildUsadosReciente(anteriores,dia.fecha,'bebe');
        lunesActual=lunes;
      }

      // ── COMIDA ──────────────────────────────────────────────────
      const blComida = dia.comida;
      if(blComida.activo){

        // 1. Adultos comida
        if(blComida._mayActivo){
          let cands = _filtrarMayores({
            platos:platosActivos, momento:'comida',
            usadosSemana, usadosReciente, artsPrioritarios, ultimoUsoMayores,
            protPorDia, diaIndex:di, esCena:false, cfgMenus,
            soloFacil: dia.facilComida, contadorGrupos,
          });
          // Fallback 1: relajar distancia mínima
          if(!cands.length){
            cands = _filtrarMayores({
              platos:platosActivos, momento:'comida',
              usadosSemana, usadosReciente:[], artsPrioritarios, ultimoUsoMayores,
              protPorDia, diaIndex:di, esCena:false, cfgMenus,
              soloFacil: dia.facilComida, contadorGrupos, relajarDistancia:true,
            });
          }
          // Último recurso: relajar equilibrio, conservando repetición, consecutivos y facilidad
          if(!cands.length){
            cands = platosActivos.filter(p=>
              (p.tipoMenu?.includes('mayores')||p.tipoMenu?.includes('todos')) &&
              p.tipoPlato !== 'segundo' &&
              _puedeUsarMayor(p,usadosSemana,di,ultimoUsoMayores) &&
              (!dia.facilComida || p.preparacionFacil) &&
              (p.tipoComida?.includes('comida')||p.tipoComida?.includes('ambos'))
            );
          }
          const p = _elegirPlato(cands, [...artsPrioritarios], inventario||[], contexto('mayores','comida'));
          if(p){
            _registrarMayor(usadosSemana, p.id, di, ultimoUsoMayores);
            _registrarProteina(protPorDia, di, p);
            _registrarGrupo(contadorGrupos, p);
            if((p.diasSobras||0) > 0 && tieneBebe)
              sobrasBebe[p.id] = (sobrasBebe[p.id]||0) + p.diasSobras;

            if(p.tipoPlato === 'primero'){
              const segundo = _elegirSegundoMayores(platosActivos, usadosSemana, usadosReciente, di, 'comida', ultimoUsoMayores, {...contexto('mayores','comida'), acompananteId:p.id}, dia.facilComida);
              blComida.platosMayores = segundo
                ? [{id:p.id,nombre:p.nombre},{id:segundo.id,nombre:segundo.nombre}]
                : [{id:p.id,nombre:p.nombre}];
              if(segundo) _registrarMayor(usadosSemana, segundo.id, di, ultimoUsoMayores);
            } else {
              blComida.platosMayores = [{id:p.id,nombre:p.nombre}];
            }
          }
        }

        // 2. Bebé comida
        if(tieneBebe && blComida._bebeActivo){
          const diasFuturos = dias.slice(di+1, di+3);
          blComida.platosBebe = _generarBloqueBebeComida(
            blComida.platosMayores, platosActivos,
            usadosBebe, usadosRecienteBebe, artsPrioritarios,
            sobrasBebe, cfgMenus, dia.facilComida, inventario||[],
            diasFuturos, contexto('bebe','comida')
          );
          // Registra en usadosBebe lo que comió el bebé al mediodía
          // para que NO se repita en la cena del mismo día
          (blComida.platosBebe||[]).forEach(p => {
            if(!usadosBebe.includes(`${p.id}_dia${di}`))
              usadosBebe.push(`${p.id}_dia${di}`);
          });
        }
      }

      // ── CENA ────────────────────────────────────────────────────
      const blCena = dia.cena;
      if(blCena.activo){

        // 1. Adultos cena — una preparación, incluidos primeros o segundos compatibles
        if(blCena._mayActivo){
          let cands = _filtrarMayores({
            platos:platosActivos, momento:'cena',
            usadosSemana, usadosReciente, artsPrioritarios, ultimoUsoMayores,
            protPorDia, diaIndex:di, esCena:true, cfgMenus,
            permitirSegundo:true, soloFacil: dia.facilCena, contadorGrupos,
          });
          // Fallback 1: relajar distancia mínima entre repeticiones
          if(!cands.length){
            cands = _filtrarMayores({
              platos:platosActivos, momento:'cena',
              usadosSemana, usadosReciente:[], artsPrioritarios, ultimoUsoMayores,
              protPorDia, diaIndex:di, esCena:true, cfgMenus,
              permitirSegundo:true, soloFacil: dia.facilCena, contadorGrupos,
              relajarDistancia: true,
            });
          }
          // Último recurso: relajar equilibrio, conservando repetición, consecutivos y facilidad
          if(!cands.length){
            cands = platosActivos.filter(p=>
              (p.tipoMenu?.includes('mayores')||p.tipoMenu?.includes('todos')) &&
              _puedeUsarMayor(p,usadosSemana,di,ultimoUsoMayores) &&
              (!dia.facilCena || p.preparacionFacil) &&
              (p.tipoComida?.includes('cena')||p.tipoComida?.includes('ambos'))
            );
          }
          const p = _elegirPlato(cands, [...artsPrioritarios], inventario||[], contexto('mayores','cena'));
          if(p){
            blCena.platosMayores = [{id:p.id,nombre:p.nombre}];
            _registrarMayor(usadosSemana, p.id, di, ultimoUsoMayores);
            _registrarProteina(protPorDia, di, p);
            _registrarGrupo(contadorGrupos, p);
          }
        }

        // 2. Bebé cena — usa lo que ya se cocinó (minimizar cocciones)
        if(tieneBebe && blCena._bebeActivo){
          blCena.platosBebe = _generarBloqueBebeConSobras(
            blCena.platosMayores, platosActivos,
            usadosBebe, usadosRecienteBebe, artsPrioritarios,
            sobrasBebe, cfgMenus, dia.facilCena, 'cena', inventario||[],
            blComida.platosMayores, di, contexto('bebe','cena')
          );
        }
      }
    }


    _menuEnCurso.dias=dias;
    _menuEnCurso.adaptacionHabitos = {
      version: 2, ventanaSemanas: habitos.ventanaSemanas, fechaCorte: habitos.fechaCorte,
      semanasObservadas: Object.fromEntries(Object.entries(habitos.perfiles).map(([perfil, momentos]) =>
        [perfil, Object.fromEntries(Object.entries(momentos).map(([momento, datos]) => [momento, datos.semanas.size]))])),
    };
    _menuEnCurso.generadoEn=new Date().toISOString();
    _setGenMsg('¡Listo!');
    await new Promise(r=>setTimeout(r,400));
    _paso=5; _renderAsistente();
  }

  // ── Helpers motor ────────────────────────────────────────────────

  function _calcularConsumidosAntesDel(historial, horizInicio) {
    // Suma las cantidades de ingredientes en menús con fechas ANTES del horizonte
    const consumidos={};
    _diasHistorial(historial,horizInicio).forEach(d=>{
      ['comida','cena'].forEach(mo=>{
        const bloque=d[mo];
        if(!bloque?.activo) return;
        [...(bloque._mayActivo===false?[]:bloque.platosMayores||[]),
          ...(bloque._bebeActivo===false?[]:bloque.platosBebe||[])].forEach(pl=>{
          const plObj=(App.getState().platos||[]).find(p=>p.id===pl.id);
          (plObj?.ingredientes||[]).forEach(ing=>{
            const k=(ing.nombre||'').toLowerCase();
            consumidos[k]=(consumidos[k]||0)+(ing.cantidad||1);
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
  function _registrarMayor(usadosSemana, id, diaIndex, ultimoUsoMayores) {
    if(!usadosSemana.has(id)) usadosSemana.set(id, []);
    const arr = usadosSemana.get(id);
    if(!arr.includes(diaIndex)) arr.push(diaIndex); // evita doble registro si comida+cena mismo día
    ultimoUsoMayores?.set(id,diaIndex);
  }

  /** Registra el grupo alimenticio de un plato para el control semanal */
  function _registrarGrupo(contadorGrupos, plato) {
    (plato.etiquetas||[]).forEach(e => {
      contadorGrupos[e] = (contadorGrupos[e]||0) + 1;
    });
  }

  function _puedeUsarMayor(plato, usadosSemana, diaIndex, ultimoUsoMayores) {
    const dias = usadosSemana.get(plato.id) || [];
    if(dias.length >= (plato.permiteRepeticion ? 2 : 1)) return false;
    const ultimo = ultimoUsoMayores?.get(plato.id) ?? dias[dias.length-1];
    return ultimo===undefined || diaIndex-ultimo>1;
  }

  // ── Filtro candidatos adultos ────────────────────────────────────

  function _filtrarMayores({platos,momento,usadosSemana,usadosReciente,
    artsPrioritarios,protPorDia,diaIndex,esCena,soloTipo,cfgMenus,forzarUnico,soloFacil,contadorGrupos,ultimoUsoMayores,permitirSegundo=false}){
    const eqCC = cfgMenus?.equilibrioComidaCena !== false;
    const eqP  = cfgMenus?.equilibrioProteinas  !== false;

    return platos.filter(p=>{
      if(!p.tipoMenu?.includes('mayores') && !p.tipoMenu?.includes('todos')) return false;
      if(soloTipo && p.tipoPlato !== soloTipo) return false;
      if(forzarUnico && p.tipoPlato !== 'unico') return false;
      if(!soloTipo && !forzarUnico && !permitirSegundo && p.tipoPlato === 'segundo') return false;
      if(!p.tipoComida?.includes(momento) && !p.tipoComida?.includes('ambos')) return false;
      if(!_puedeUsarMayor(p,usadosSemana,diaIndex,ultimoUsoMayores)) return false;
      const minSem = p.frecuenciaMinSemanas || 2;
      if(usadosReciente[p.id]!==undefined && usadosReciente[p.id] < minSem) return false;
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
  function _elegirSegundoMayores(platosActivos, usadosSemana, usadosReciente, diaIndex, momento, ultimoUsoMayores, contexto, soloFacil=false) {
    const cands = platosActivos.filter(p => {
      if(p.tipoPlato !== 'segundo') return false;
      if(soloFacil && !p.preparacionFacil) return false;
      if(!p.tipoMenu?.includes('mayores') && !p.tipoMenu?.includes('todos')) return false;
      if(!p.tipoComida?.includes(momento) && !p.tipoComida?.includes('ambos')) return false;
      if(!_puedeUsarMayor(p,usadosSemana,diaIndex,ultimoUsoMayores)) return false;
      const minSem = p.frecuenciaMinSemanas || 2;
      if(usadosReciente[p.id]!==undefined && usadosReciente[p.id] < minSem) return false;
      return true;
    });
    if(!cands.length) return null;
    return _elegirPlato(cands, [], [], contexto);
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
    diasFuturos, contexto) {

    // 1. Platos de adultos compatibles con bebé ese mismo día
    const compatAdultos = (platosAdultos||[]).filter(pa => {
      const db = platosActivos.find(p => p.id === pa.id);
      return db && (db.tipoMenu.includes('todos') || db.tipoMenu.includes('bebe'));
    });

    if(compatAdultos.length > 0){
      return _asegurarPrimeroSegundo(compatAdultos, platosActivos, usadosBebe, usadosReciente, 'comida', contexto);
    }

    // 2. Sobras disponibles de días anteriores
    const sobra = _elegirDeSobras(sobrasBebe, platosActivos);
    if(sobra){
      sobrasBebe[sobra.id]--;
      if(sobrasBebe[sobra.id] <= 0) delete sobrasBebe[sobra.id];
      return _completarPrimeroSegundo([{id:sobra.id,nombre:sobra.nombre}],
        platosActivos, sobra, usadosBebe, usadosReciente, 'comida', contexto);
    }

    // 3. Plato propio de bebé:
    //    - Si es tipoMenu:['bebe'] → se usa libremente (puré, etc., cocina específica)
    //    - Si es tipoMenu:['todos'] → solo si los adultos lo comerán en próximos 2 días
    const cands = _filtrarCandidatosBebe(platosActivos, 'comida', usadosBebe, usadosReciente);
    
    // Primero intenta con platos exclusivos de bebé (sin restricción de adultos)
    const candsSoloBebe = cands.filter(p => 
      p.tipoMenu?.length === 1 && p.tipoMenu[0] === 'bebe'
    );
    const pSoloBebe = _elegirPlato(candsSoloBebe, [...artsPrioritarios], inventario, contexto);
    if(pSoloBebe){
      usadosBebe.push(pSoloBebe.id);
      if((pSoloBebe.diasSobras||0) > 0) sobrasBebe[pSoloBebe.id] = (sobrasBebe[pSoloBebe.id]||0) + pSoloBebe.diasSobras;
      return _completarPrimeroSegundo([{id:pSoloBebe.id,nombre:pSoloBebe.nombre}],
        platosActivos, pSoloBebe, usadosBebe, usadosReciente, 'comida', contexto);
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
      ? _elegirPlato(candsCompartidos, [...artsPrioritarios], inventario, contexto)
      : null;

    if(platoBebe){
      usadosBebe.push(platoBebe.id);
      if((platoBebe.diasSobras||0) > 0) sobrasBebe[platoBebe.id] = (sobrasBebe[platoBebe.id]||0) + platoBebe.diasSobras;
      return _completarPrimeroSegundo([{id:platoBebe.id,nombre:platoBebe.nombre}],
        platosActivos, platoBebe, usadosBebe, usadosReciente, 'comida', contexto);
    }

    // Fallback: cualquier plato de bebé aunque no coincida con adultos
    const pFallback = _elegirPlato(cands, [...artsPrioritarios], inventario, contexto);
    if(pFallback){
      usadosBebe.push(pFallback.id);
      if((pFallback.diasSobras||0) > 0) sobrasBebe[pFallback.id] = (sobrasBebe[pFallback.id]||0) + pFallback.diasSobras;
      return _completarPrimeroSegundo([{id:pFallback.id,nombre:pFallback.nombre}],
        platosActivos, pFallback, usadosBebe, usadosReciente, 'comida', contexto);
    }

    return platosAdultos||[];
  }

  /**
   * Genera el bloque de bebé para la CENA.
   * Prioriza preparaciones compartidas y sobras; si no hay, elige un plato propio compatible.
   * Prioridad:
   *   1. Sobras del mediodía de ese mismo día (platosMayores comida)
   *   2. Plato de cena de adultos si es compatible
   *   3. Sobras de días anteriores registradas en sobrasBebe
   *   4. Si no queda ninguna opción compartida, busca en el catálogo de bebé
   */
  function _generarBloqueBebeConSobras(platosAdultos, platosActivos, usadosBebe,
    usadosReciente, artsPrioritarios, sobrasBebe, cfgMenus, soloFacil, momento, inventario,
    platosComidaHoy, diaIndex, contexto) {

    // IDs que el bebé ya comió hoy al mediodía — no repetir en cena
    const yaComidosHoy = new Set(
      (platosComidaHoy||[]).map(p => p.id)
    );
    // También marca con diaIndex para saber que es de hoy
    const yaMarcadosHoy = id => usadosBebe.includes(`${id}_dia${diaIndex}`);

    // 1. Sobras del mediodía de HOY que NO sean lo mismo que ya comió el bebé
    // (buscamos algo diferente al mediodía para dar variedad en cena)
    // Si el bebé comió lo mismo que adultos al mediodía, buscamos algo diferente en cena
    if(platosComidaHoy?.length){
      const compatHoyDiferente = platosComidaHoy.filter(pa => {
        if(yaMarcadosHoy(pa.id)) return false;  // ya lo comió el bebé al mediodía
        const db = platosActivos.find(p => p.id === pa.id);
        return db && (db.tipoMenu.includes('todos') || db.tipoMenu.includes('bebe'));
      });
      if(compatHoyDiferente.length > 0){
        return _asegurarPrimeroSegundo(compatHoyDiferente,
          platosActivos, usadosBebe, usadosReciente, momento, contexto);
      }
    }

    // 2. Plato de cena de adultos si es compatible y diferente a lo del mediodía
    const platoCenaAd = (platosAdultos||[])[0];
    const dbCenaAd = platoCenaAd && !yaMarcadosHoy(platoCenaAd.id)
      ? platosActivos.find(p => p.id===platoCenaAd.id &&
          (p.tipoMenu.includes('todos') || p.tipoMenu.includes('bebe')))
      : null;
    if(dbCenaAd){
      return _completarPrimeroSegundo([{id:dbCenaAd.id,nombre:dbCenaAd.nombre}],
        platosActivos, dbCenaAd, usadosBebe, usadosReciente, momento, contexto);
    }

    // 3. Sobras de días anteriores (diferentes a lo de hoy)
    const sobra = _elegirDeSobrasExcluyendo(sobrasBebe, platosActivos, yaComidosHoy);
    if(sobra){
      sobrasBebe[sobra.id]--;
      if(sobrasBebe[sobra.id] <= 0) delete sobrasBebe[sobra.id];
      return _completarPrimeroSegundo([{id:sobra.id,nombre:sobra.nombre}],
        platosActivos, sobra, usadosBebe, usadosReciente, momento, contexto);
    }

    // 4. Fallback: acepta repetir si no hay otra opción
    const sobrasAny = _elegirDeSobras(sobrasBebe, platosActivos);
    if(sobrasAny){
      sobrasBebe[sobrasAny.id]--;
      if(sobrasBebe[sobrasAny.id] <= 0) delete sobrasBebe[sobrasAny.id];
      return _completarPrimeroSegundo([{id:sobrasAny.id,nombre:sobrasAny.nombre}],
        platosActivos, sobrasAny, usadosBebe, usadosReciente, momento, contexto);
    }

    // Último recurso: plato de cena adultos aunque ya lo comiera
    if(platoCenaAd){
      const db = platosActivos.find(p=>p.id===platoCenaAd.id &&
        (p.tipoMenu.includes('todos')||p.tipoMenu.includes('bebe')));
      if(db) return _completarPrimeroSegundo([{id:db.id,nombre:db.nombre}],
        platosActivos, db, usadosBebe, usadosReciente, momento, contexto);
    }

    // Si no hay comida compartida ni sobras, la cena del bebé sigue necesitando un plato propio.
    const candidatos = _filtrarCandidatosBebe(platosActivos, momento, usadosBebe, usadosReciente)
      .filter(p => !soloFacil || p.preparacionFacil);
    const propio = _elegirPlato(candidatos, [...artsPrioritarios], inventario, contexto);
    if(!propio) return [];
    usadosBebe.push(propio.id);
    return _completarPrimeroSegundo([{id:propio.id,nombre:propio.nombre}],
      platosActivos, propio, usadosBebe, usadosReciente, momento, contexto);
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
      if(usadosReciente[p.id]!==undefined && usadosReciente[p.id] < minSem) return false;
      return true;
    });
  }

  /**
   * Dado un array de platos iniciales del bebé:
   * - Si el primer plato es 'unico' → devuelve tal cual
   * - Si es 'primero' → busca un segundo
   * - Si es 'segundo' → busca un primero (error de configuración, intenta corregir)
   */
  function _completarPrimeroSegundo(platosRef, platosActivos, platoObjeto, usadosBebe, usadosReciente, momento, contexto) {
    // Busca el tipo real del plato en la base de datos (puede que platoObjeto no tenga tipoPlato)
    const platoDBId = platoObjeto?.id || platosRef?.[0]?.id;
    const platoDB   = platoDBId ? platosActivos.find(p=>p.id===platoDBId) : null;
    const tipo      = platoDB?.tipoPlato || platoObjeto?.tipoPlato || 'unico';

    contexto = {...contexto, acompananteId:platoDBId};
    if(tipo === 'unico') return platosRef;  // plato único: no necesita complemento

    if(tipo === 'segundo'){
      // Tenemos un segundo solo: buscamos un primero para ponerlo antes
      const primero = _elegirPrimeroBebe(platosActivos, usadosBebe, usadosReciente, momento, contexto);
      if(primero){ usadosBebe.push(primero.id); return [{id:primero.id,nombre:primero.nombre}, ...platosRef]; }
      return platosRef;
    }

    if(tipo === 'primero'){
      // Tenemos un primero: buscamos un segundo
      const segundo = _elegirSegundoBebe(platosActivos, usadosBebe, usadosReciente, momento, contexto);
      if(segundo){ usadosBebe.push(segundo.id); return [...platosRef, {id:segundo.id,nombre:segundo.nombre}]; }
    }

    return platosRef;
  }

  /**
   * Dado array de platos de adultos compatibles con bebé,
   * asegura que el bebé tenga primero+segundo si el primero no es único.
   */
  function _asegurarPrimeroSegundo(compatAdultos, platosActivos, usadosBebe, usadosReciente, momento, contexto) {
    if(!compatAdultos.length) return [];
    // Si ya tiene dos platos, devuelve tal cual
    if(compatAdultos.length >= 2) return compatAdultos;
    const primerRef = compatAdultos[0];
    const primerDB  = platosActivos.find(p => p.id === primerRef.id);
    const tipo      = primerDB?.tipoPlato || 'unico';

    contexto = {...contexto, acompananteId:primerRef.id};
    if(tipo === 'unico') return compatAdultos;  // plato único: no añadir segundo

    if(tipo === 'segundo'){
      // Solo tenemos un segundo: buscamos primero
      const primero = _elegirPrimeroBebe(platosActivos, usadosBebe, usadosReciente, momento, contexto);
      if(primero){ usadosBebe.push(primero.id); return [{id:primero.id,nombre:primero.nombre}, ...compatAdultos]; }
      return compatAdultos;
    }

    // tipo === 'primero': busca segundo
    const segundo = _elegirSegundoBebe(platosActivos, usadosBebe, usadosReciente, momento, contexto);
    if(segundo){ usadosBebe.push(segundo.id); return [...compatAdultos, {id:segundo.id,nombre:segundo.nombre}]; }
    return compatAdultos;
  }

  function _elegirPrimeroBebe(platosActivos, usadosBebe, usadosReciente, momento, contexto) {
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
    return _elegirPlato(menosUsados, [], [], contexto);
  }

  function _elegirSegundoBebe(platosActivos, usadosBebe, usadosReciente, momento, contexto) {
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
    return _elegirPlato(menosUsados, [], [], contexto);
  }

  function _elegirDeSobras(sobrasBebe, platosActivos) {
    const disponibles = Object.keys(sobrasBebe).filter(id => sobrasBebe[id] > 0);
    if(!disponibles.length) return null;
    disponibles.sort((a,b) => sobrasBebe[b] - sobrasBebe[a]);
    return platosActivos.find(p => p.id === disponibles[0]) || null;
  }

  function _elegirDeSobrasExcluyendo(sobrasBebe, platosActivos, excluir) {
    const disponibles = Object.keys(sobrasBebe)
      .filter(id => sobrasBebe[id] > 0 && !excluir.has(id));
    if(!disponibles.length) return null;
    disponibles.sort((a,b) => sobrasBebe[b] - sobrasBebe[a]);
    return platosActivos.find(p => p.id === disponibles[0]) || null;
  }


  function _semanasHabitos(valor) {
    return Number.isInteger(valor) && valor>=2 && valor<=12 ? valor : 4;
  }

  /** Aprende preferencias en los últimos N × 7 días, excluyendo hoy y el horizonte futuro. */
  function _construirHabitos(historial, platos, fechaReferencia, semanas=4) {
    const hoy = Dates.today();
    const fechaCorte = fechaReferencia < hoy ? fechaReferencia : hoy;
    const ventanaSemanas = _semanasHabitos(semanas);
    const desde = Dates.addDays(fechaCorte, -ventanaSemanas*7);
    const nuevaEstadistica = () => ({ semanas: new Set(), total: 0, platos: new Map(), tipos: new Map(), dias: new Map(), jornadas: new Map(), parejas: new Map() });
    const modelo = {
      fechaCorte,
      ventanaSemanas,
      perfiles: Object.fromEntries(['mayores','bebe'].map(perfil =>
        [perfil, { comida: nuevaEstadistica(), cena: nuevaEstadistica() }])),
    };
    const porId = new Map(platos.map(plato => [plato.id, plato]));
    const porNombre = new Map(platos.map(plato => [Sync.normalize(plato.nombre), plato]));
    const menus = historial.filter(menu => ['confirmado','historico'].includes(menu.estado));
    for (const dia of _diasHistorial(menus, fechaCorte)) {
      if (dia.fecha < desde) continue;
      const diaSemana = Dates.fromISO(dia.fecha).getDay();
      const semana = Dates.startOfWeek(dia.fecha);
      for (const momento of ['comida','cena']) {
        const bloque = dia[momento];
        if (!bloque?.activo) continue;
        for (const [perfil, campo, activo] of [
          ['mayores','platosMayores','_mayActivo'], ['bebe','platosBebe','_bebeActivo'],
        ]) {
          if (bloque[activo] === false) continue;
          if (!Array.isArray(bloque[campo]) || !bloque[campo].length) continue;
          const conocidos = new Map();
          for (const ref of bloque[campo] || []) {
            const plato = porId.get(ref.id) || porNombre.get(Sync.normalize(ref.nombre));
            if (plato) conocidos.set(plato.id, plato);
          }
          const datos = modelo.perfiles[perfil][momento];
          datos.total++;
          datos.semanas.add(semana);
          if (!datos.dias.has(diaSemana)) datos.dias.set(diaSemana, { total: 0, platos: new Map() });
          const jornada = datos.dias.get(diaSemana);
          jornada.total++;
          const tipoJornada = diaSemana===0 || diaSemana===6 ? 'finde' : 'laborable';
          if(!datos.jornadas.has(tipoJornada)) datos.jornadas.set(tipoJornada,
            { total: 0, semanas: new Set(), platos: new Map(), preparaciones: new Map() });
          const grupo = datos.jornadas.get(tipoJornada);
          grupo.total++;
          grupo.semanas.add(semana);
          const tipos = new Set();
          const preparaciones = new Set();
          for (const plato of conocidos.values()) {
            datos.platos.set(plato.id, (datos.platos.get(plato.id) || 0) + 1);
            jornada.platos.set(plato.id, (jornada.platos.get(plato.id) || 0) + 1);
            if(!datos.parejas.has(plato.id)) datos.parejas.set(plato.id, new Map());
            const parejas = datos.parejas.get(plato.id);
            for(const otro of conocidos.values()) {
              if(otro.id!==plato.id) parejas.set(otro.id, (parejas.get(otro.id) || 0) + 1);
            }
            grupo.platos.set(plato.id, (grupo.platos.get(plato.id) || 0) + 1);
            if(typeof plato.preparacionFacil === 'boolean') preparaciones.add(plato.preparacionFacil);
            if (plato.tipoPlato) tipos.add(plato.tipoPlato);
          }
          tipos.forEach(tipo => datos.tipos.set(tipo, (datos.tipos.get(tipo) || 0) + 1));
          preparaciones.forEach(facil => grupo.preparaciones.set(facil, (grupo.preparaciones.get(facil) || 0) + 1));
        }
      }
    }
    return modelo;
  }

  function _pesoHabito(plato, contexto) {
    const datos = contexto?.modelo?.perfiles[contexto.perfil]?.[contexto.momento];
    if (!datos || datos.semanas.size < 2 || !datos.total) return 1;
    const jornada = datos.dias.get(Dates.fromISO(contexto.fecha).getDay());
    const frecuencia = (datos.platos.get(plato.id) || 0) / datos.total;
    const tipo = (datos.tipos.get(plato.tipoPlato) || 0) / datos.total;
    // Suaviza patrones de un día de la semana cuando hay pocas observaciones.
    const mismoDia = jornada ? (jornada.platos.get(plato.id) || 0) / (jornada.total + 2) : 0;
    const diaSemana = Dates.fromISO(contexto.fecha).getDay();
    const grupo = datos.jornadas?.get(diaSemana===0 || diaSemana===6 ? 'finde' : 'laborable');
    // Normaliza por comidas observadas: no compara los cinco laborables contra dos días de fin de semana.
    const suficiente = grupo?.semanas.size>=2;
    const rutina = suficiente ? (grupo.platos.get(plato.id) || 0) / (grupo.total + 2) : 0;
    const facilidad = suficiente ? (grupo.preparaciones.get(plato.preparacionFacil) || 0) / (grupo.total + 2) : 0;
    const aparicionesPareja = datos.parejas?.get(contexto.acompananteId)?.get(plato.id) || 0;
    const pareja = aparicionesPareja>=2
      ? aparicionesPareja / ((datos.platos.get(contexto.acompananteId) || 0) + 2) : 0;
    return Math.min(6, 1 + 2*frecuencia + 2*mismoDia + tipo + rutina + facilidad + 2*pareja);
  }

  function _elegirPlato(candidatos, artsPrioritarios, inventario, contexto) {
    if (!candidatos.length) return null;
    const puntuados = candidatos.map(plato => ({
      plato,
      prioridad: (plato.ingredientes || []).filter(ing => artsPrioritarios.includes((ing.nombre || '').toLowerCase())).length,
      peso: _pesoHabito(plato, contexto),
    }));
    // El stock prioritario conserva precedencia; los hábitos deciden entre opciones equivalentes.
    const prioridad = Math.max(...puntuados.map(item => item.prioridad));
    const opciones = puntuados.filter(item => item.prioridad === prioridad);
    const datos = contexto?.modelo?.perfiles[contexto.perfil]?.[contexto.momento];
    const habituales = datos?.semanas.size>=2
      ? opciones.filter(item => datos.platos.has(item.plato.id)) : [];
    if(habituales.length && habituales.length<opciones.length){
      const total = opciones.reduce((sum,item) => sum+item.peso,0);
      const totalHabituales = habituales.reduce((sum,item) => sum+item.peso,0);
      // Reserva variedad sin que un catálogo grande de platos no observados diluya toda la rutina.
      for(const item of opciones) item.peso = 0.2*item.peso/total
        + (datos.platos.has(item.plato.id) ? 0.8*item.peso/totalHabituales : 0);
    }
    let sorteo = Math.random() * opciones.reduce((total, item) => total + item.peso, 0);
    for (const opcion of opciones) {
      sorteo -= opcion.peso;
      if (sorteo < 0) return opcion.plato;
    }
    return opciones[opciones.length - 1].plato;
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

  function _diasHistorial(historial,antesDe) {
    return _combinarDiasDeMenus(historial.filter(m=>m.estado!=='borrador'))
      .filter(d=>d.fecha<antesDe);
  }

  function _buildUsadosReciente(historial,fechaReferencia,perfil='mayores'){
    const res={};
    const lunesReferencia=Dates.startOfWeek(fechaReferencia);
    const campo=perfil==='bebe'?'platosBebe':'platosMayores';
    _diasHistorial(historial,fechaReferencia).forEach(d=>{
      const sem=(Date.parse(lunesReferencia)-Date.parse(Dates.startOfWeek(d.fecha)))/604800000;
      ['comida','cena'].forEach(m=>{
        const bloque=d[m];
        if(!bloque?.activo || (perfil==='bebe'?bloque._bebeActivo:bloque._mayActivo)===false) return;
        (bloque[campo]||[]).forEach(p=>{
          if(res[p.id]===undefined||res[p.id]>sem) res[p.id]=sem;
        });
      });
    });
    return res;
  }

  async function _cargarHistorialReciente(n,fechaReferencia,fechaBase=fechaReferencia){
    try{
      const arch=await Drive.listMenuFiles();
      const menus=[];
      const desde=Dates.addDays(Dates.startOfWeek(fechaBase),-n*7);
      // El nombre del archivo no determina ni su antigüedad ni los días que contiene.
      for(let i=0;i<arch.length;i+=4){
        const lote=await Promise.all(arch.slice(i,i+4).map(f=>Drive.readMenuJson(f.id).catch(()=>null)));
        lote.forEach(m=>{
          if(!m||m.estado==='borrador') return;
          const dias=(m.dias||[]).filter(d=>d.fecha>=desde&&d.fecha<fechaReferencia);
          if(dias.length) menus.push({...m,dias});
        });
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
    if (_guardando) return;
    _guardando = true;
    const edicion = _edicion;
    if(btn){btn.disabled=true;btn.textContent='Guardando...';}
    document.getElementById('menu-btn-cancelar')?.setAttribute('disabled','');
    try {
      const menu = { ..._menuEnCurso, confirmadoEn: new Date().toISOString() };
      if (!edicion) menu.estado = 'confirmado';
      const fileName = edicion?.fileName || `semana_${menu.fechaInicio}.json`;
      await Drive.writeMenuJson(fileName, menu, edicion?.fileId);
      const notifs = Notificaciones.generarParaMenu(menu);
      const anteriores = new Set(edicion ? Notificaciones.generarParaMenu(edicion.original).map(n => n.id) : []);
      const config = App.getState().config || {};
      const pendientes = edicion ? (config.notificaciones?.pendientes || []).filter(n => !anteriores.has(n.id)) : [];
      await App.setState('config', { ...config, notificaciones: {
        ...(config.notificaciones || {}),
        pendientes: [...new Map([...pendientes, ...notifs].map(n => [n.id,n])).values()],
      } });
      if (!edicion || App.getState().menuActual?.id === menu.id) App.getState().menuActual = menu;
      UI.showToast(edicion ? 'Cambios guardados ✓' : 'Menú confirmado ✓','success',2000);
      const destino = edicion?.origen || 'compra';
      _edicion = null;
      _paso = 0;
      App.navigate(destino);
    } catch (err) {
      UI.showToast(`No se pudo guardar el menú: ${err.message}`, 'error');
      if (btn) { btn.disabled = false; btn.textContent = edicion ? 'Guardar cambios' : '✓ Confirmar menú'; }
    } finally {
      _guardando = false;
      document.getElementById('menu-btn-cancelar')?.removeAttribute('disabled');
    }
  }

  // ── Popup platos ─────────────────────────────────────────────────

  // Estado copiar/pegar entre celdas
  let _portapapeles = null;  // { platos: [], label: '' }

  function _abrirPopupPlato(fecha, momento, perfil){
    if (_guardando) return;
    const state = App.getState();
    const platosActivos = (state.platos||[]).filter(p=>p.activo!==false);
    const dia = _menuEnCurso.dias.find(d=>d.fecha===fecha);
    const arr = perfil==='bebe' ? 'platosBebe' : 'platosMayores';
    const platosActuales = dia?.[momento]?.[arr] || [];
    const esCenaAdulto = momento==='cena' && perfil==='mayores';

    // Sin filtro adulto/bebé — se muestran TODOS los platos
    // Los platos de adultos llevan badge de advertencia cuando se asignan al bebé
    const compatibles = platosActivos.filter(p=>{
      const mOk = p.tipoComida?.includes(momento) || p.tipoComida?.includes('ambos') ||
                  (perfil==='bebe' && momento==='cena' && p.tipoComida?.includes('comida'));
      return mOk;
    });

    const soloUnicos = compatibles.filter(p=>p.tipoPlato==='unico');
    const primeros   = compatibles.filter(p=>p.tipoPlato==='primero');
    const segundos   = compatibles.filter(p=>p.tipoPlato==='segundo');

    const container = document.createElement('div');
    
    // Barra de herramientas: copiar/pegar + checkbox sync
    const tieneBebe = (state.config?.personas||[]).some(p=>p.tipo==='bebe');
    const mostrarSync = tieneBebe && perfil==='mayores';

    container.innerHTML = `
      <!-- Toolbar: copiar/pegar + sync -->
      <div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3);flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" id="popup-btn-copiar" title="Copiar esta comida al portapapeles">
          📋 Copiar comida
        </button>
        <button class="btn btn-secondary btn-sm" id="popup-btn-pegar"
                style="${_portapapeles ? '' : 'opacity:0.4;pointer-events:none'}"
                title="${_portapapeles ? 'Pegar: ' + _portapapeles.label : 'Portapapeles vacío'}">
          📌 Pegar ${_portapapeles ? '('+_portapapeles.label+')' : ''}
        </button>
        ${mostrarSync ? `
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-left:auto;font-size:var(--font-size-xs)">
            <input type="checkbox" id="popup-sync-bebe"/>
            <span>Sync bebé</span>
          </label>` : ''}
      </div>

      <div class="search-bar" style="margin-bottom:var(--space-3)">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input type="search" id="popup-plato-search" placeholder="Buscar plato..." autocomplete="off"/>
      </div>

      <div id="popup-seleccion-actual" style="margin-bottom:var(--space-3)">
        ${_buildSeleccionActual(platosActuales)}
      </div>

      <div class="pl-chips pl-chips--form" style="margin-bottom:var(--space-3)" id="popup-tabs">
        <button class="pl-chip active" data-tab="todos">Todos</button>
        <button class="pl-chip" data-tab="unico">🍽 Único</button>
        ${!esCenaAdulto ? '<button class="pl-chip" data-tab="primero">1️⃣ Primero</button>' : ''}
        ${!esCenaAdulto ? '<button class="pl-chip" data-tab="segundo">2️⃣ Segundo</button>' : ''}
      </div>

      <div id="popup-plato-list" class="popup-plato-list">${_buildPopupPlatos(compatibles,'',perfil)}</div>`;

    const modal = UI.showModal({
      title: `${momento==='comida'?'🍽 Comida':'🌙 Cena'} · ${perfil==='bebe'?'Bebé':'Adultos'}`,
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
        if(filtroTexto) pool = pool.filter(p=>Sync.normalize(p.nombre).includes(filtroTexto));
        return pool;
      }

      function refresh() {
        const list = document.getElementById('popup-plato-list');
        if(list) list.innerHTML = _buildPopupPlatos(getFiltrados(),'',perfil);
        _bindPopupPlatos(fecha, momento, perfil, modal, arr, container);
      }

      // Copiar comida actual al portapapeles
      document.getElementById('popup-btn-copiar')?.addEventListener('click', ()=>{
        if(platosActuales.length){
          _portapapeles = {
            platos: [...platosActuales],
            label: platosActuales.map(p=>p.nombre).join(' + '),
          };
          UI.showToast(`Copiado: ${_portapapeles.label}`,'success');
          modal.close();
        } else {
          UI.showToast('No hay platos que copiar','info');
        }
      });

      // Pegar del portapapeles
      document.getElementById('popup-btn-pegar')?.addEventListener('click', ()=>{
        if(!_portapapeles) return;
        const dia = _menuEnCurso.dias.find(d=>d.fecha===fecha);
        if(!dia) return;
        dia[momento][arr] = [..._portapapeles.platos];
        _actualizarCeldaCalendario(fecha, momento, perfil, _portapapeles.platos);
        // Si sync activo, también en bebé
        if(document.getElementById('popup-sync-bebe')?.checked && perfil==='mayores'){
          dia[momento].platosBebe = [..._portapapeles.platos];
          _actualizarCeldaCalendario(fecha, momento, 'bebe', _portapapeles.platos);
        }
        UI.showToast(`Pegado: ${_portapapeles.label}`,'success');
        modal.close();
      });

      // Tabs
      container.querySelectorAll('#popup-tabs .pl-chip').forEach(btn=>{
        btn.addEventListener('click',()=>{
          container.querySelectorAll('#popup-tabs .pl-chip').forEach(b=>b.classList.remove('active'));
          btn.classList.add('active');
          tabActual = btn.dataset.tab;
          refresh();
        });
      });

      const inp = document.getElementById('popup-plato-search');
      inp?.focus();
      inp?.addEventListener('input',e=>{ filtroTexto=Sync.normalize(e.target.value); refresh(); });

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
    const f = filtro ? platos.filter(p=>Sync.normalize(p.nombre).includes(Sync.normalize(filtro))) : platos;
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
        const selEl = document.getElementById('popup-seleccion-actual');
        if(selEl) selEl.innerHTML = _buildSeleccionActual(platosArr);
        _actualizarCeldaCalendario(fecha, momento, perfil, platosArr);
        _bindPopupPlatos(fecha, momento, perfil, modal, arr, container);
      });
    });

    const syncBebe = () => document.getElementById('popup-sync-bebe')?.checked && perfil==='mayores';

    // Seleccionar plato
    document.querySelectorAll('.popup-plato-item').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const dia = _menuEnCurso.dias.find(d=>d.fecha===fecha);
        if(!dia) return;
        const platosArr = dia[momento][arr] || [];
        const tipo = btn.dataset.tipo;
        const nuevoPlato = {id:btn.dataset.id, nombre:btn.dataset.nombre};
        const esCenaAdulto = momento==='cena' && perfil==='mayores';

        let nuevos;
        if(esCenaAdulto || tipo==='unico') {
          nuevos = [nuevoPlato];
        } else if(tipo==='primero') {
          const segundoExistente = platosArr.find(p=>{
            const db=(App.getState().platos||[]).find(pl=>pl.id===p.id);
            return db?.tipoPlato==='segundo';
          });
          nuevos = segundoExistente ? [nuevoPlato, segundoExistente] : [nuevoPlato];
        } else if(tipo==='segundo') {
          const primeroExistente = platosArr.find(p=>{
            const db=(App.getState().platos||[]).find(pl=>pl.id===p.id);
            return db?.tipoPlato==='primero';
          });
          nuevos = primeroExistente ? [primeroExistente, nuevoPlato] : [nuevoPlato];
        } else {
          nuevos = [nuevoPlato];
        }

        dia[momento][arr] = nuevos;
        _actualizarCeldaCalendario(fecha, momento, perfil, nuevos);

        // Sync bebé si checkbox activo
        if(syncBebe()){
          dia[momento].platosBebe = [...nuevos];
          _actualizarCeldaCalendario(fecha, momento, 'bebe', nuevos);
        }

        // Si es único o segundo cierra, si es primero permite añadir segundo
        if(tipo==='primero' && !esCenaAdulto){
          const selEl = document.getElementById('popup-seleccion-actual');
          if(selEl) selEl.innerHTML = _buildSeleccionActual(nuevos);
          _bindPopupPlatos(fecha, momento, perfil, modal, arr, container);
        } else {
          modal.close();
        }
      });
    });
  }

  function _actualizarCeldaCalendario(fecha, momento, perfil, platos) {
    const dia=_menuEnCurso.dias.find(item=>item.fecha===fecha);
    const bloque=dia?.[momento];
    if(bloque){
      const campoActivo=perfil==='bebe'?'_bebeActivo':'_mayActivo';
      bloque.activo=true;
      bloque[campoActivo]=true;
      bloque.edicionManual=[...new Set([...(bloque.edicionManual||[]),perfil])];
    }
    const celda = document.querySelector(
      `.menu-cal-celda[data-fecha="${fecha}"][data-momento="${momento}"][data-perfil="${perfil}"]`
    );
    if(celda){
      celda.textContent = platos.map(p=>p.nombre).join(' + ') || '+';
      celda.title='Añadido manualmente al menú';
      celda.setAttribute('aria-label','Añadido manualmente al menú');
      celda.classList.remove('menu-cal-celda--esp');
      celda.classList.add('menu-cal-celda--edit');
    }
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
    document.getElementById('menu-bebe-solo-cenas')?.addEventListener('change',e=>{
      _menuEnCurso.bebeSoloCenasLaborables=e.target.checked;
    });
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
        const fecha   = td.dataset.fecha;
        const momento = td.dataset.momento;
        const perfil  = td.dataset.perfil;

        // Si el día no existe en _menuEnCurso, lo crea (día vacío editable)
        let dia = _menuEnCurso.dias.find(d=>d.fecha===fecha);
        if (!dia) {
          dia = {
            fecha, diaSemana: Dates.dayName(fecha),
            tipoEspecial: null, esDiaFacil: false, facilComida: false, facilCena: false,
            comida: { activo: true, _mayActivo: true, _bebeActivo: true, platosMayores: [], platosBebe: [] },
            cena:   { activo: true, _mayActivo: true, _bebeActivo: true, platosMayores: [], platosBebe: [] },
          };
          _menuEnCurso.dias.push(dia);
          _menuEnCurso.dias.sort((a,b)=>a.fecha.localeCompare(b.fecha));
        }
        // Si el bloque no existe, lo inicializa
        if (!dia[momento]) {
          dia[momento] = { activo: true, _mayActivo: true, _bebeActivo: true, platosMayores: [], platosBebe: [] };
        }

        _abrirPopupPlato(fecha, momento, perfil);
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

  return { render, getCalendarioHTML, editar };

})();
