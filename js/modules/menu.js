/**
 * MenuApp — Módulo de Menú (Fase 3 + fixes Fase 5)
 *
 * Cambios v2:
 * - Visualización como calendario horizontal con scroll
 * - Cabeceras Comida/Cena a la izquierda, Adultos/Bebé como subfilas
 * - Combinar menús: días nuevos sobreescriben días existentes
 * - Días especiales corregidos: afectan solo al perfil indicado
 * - Calendarios arrancan en lunes
 *
 * @module Menu
 */

const Menu = (() => {

  let _paso = 0;
  let _menuEnCurso = null;

  const ETIQUETAS_PROTEINA = {
    carne:    ['carne','pollo','cerdo','ternera','pavo','cordero'],
    pescado:  ['pescado','marisco','merluza','lubina','salmón','atún','bacalao'],
    legumbre: ['legumbre','garbanzos','lentejas','alubias','judías'],
    huevo:    ['huevo','tortilla','revuelto'],
    pasta:    ['pasta','macarrones','espagueti','fideos','arroz'],
  };

  // ── API pública ──────────────────────────────────────────────────

  function render() {
    _ensureView();
    _paso = 0;
    _renderVista();
  }

  // ── Vista principal ──────────────────────────────────────────────

  async function _renderVista() {
    const view = document.getElementById('view-menu');
    if (!view) return;

    const hoy = Dates.today();
    const menusEnDrive = await Drive.listMenuFiles().catch(()=>[]);

    // Carga TODOS los menús para construir el calendario combinado
    const todosMenus = [];
    for (const f of menusEnDrive) {
      try {
        const m = await Drive.readMenuJson(f.id);
        if (m) todosMenus.push(m);
      } catch { /* continúa */ }
    }

    // Menú activo (que incluye hoy)
    const menuActivo = todosMenus.find(m =>
      m.fechaInicio <= hoy && m.fechaFin >= hoy && m.estado !== 'historico'
    );

    // Construye vista combinada de todos los días cubiertos
    const diasCombinados = _combinarDiasDeMenus(todosMenus);
    App.getState().menuActual = menuActivo || null;

    view.innerHTML = `
      <div class="module-header">
        <h1 class="module-title">Menú</h1>
        <button class="btn btn-primary btn-sm" id="menu-btn-nuevo">+ Nuevo</button>
      </div>

      ${diasCombinados.length > 0
        ? `<div class="menu-calendario-wrapper" id="menu-cal-wrapper">
             ${_buildCalendario(diasCombinados)}
           </div>
           <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4)">
             ${menuActivo
               ? `<button class="btn btn-secondary" style="flex:1" id="menu-btn-editar">✏️ Editar semana actual</button>
                  <button class="btn btn-primary" style="flex:1" id="menu-btn-compra">🛒 Ir a la compra</button>`
               : `<button class="btn btn-primary btn-full" id="menu-btn-nuevo2">Generar menú de esta semana</button>`}
           </div>`
        : `<div class="card card-empty">
             <div class="empty-state-icon">📅</div>
             <p>No hay menú generado todavía.</p>
             <button class="btn btn-primary" id="menu-btn-nuevo2">Generar primer menú</button>
           </div>`}
    `;

    document.getElementById('menu-btn-nuevo')?.addEventListener('click', _iniciarAsistente);
    document.getElementById('menu-btn-nuevo2')?.addEventListener('click', _iniciarAsistente);
    document.getElementById('menu-btn-editar')?.addEventListener('click', () => {
      if (menuActivo) { _menuEnCurso = JSON.parse(JSON.stringify(menuActivo)); _paso=5; _renderAsistente(); }
    });
    document.getElementById('menu-btn-compra')?.addEventListener('click', () => App.navigate('compra'));
  }

  // ── Combinar días de múltiples menús ────────────────────────────

  /**
   * Une todos los días de todos los menús. Si una fecha aparece en
   * varios menús, prevalece el más reciente (generadoEn más tardío).
   */
  function _combinarDiasDeMenus(menus) {
    const porFecha = {};
    menus.forEach(m => {
      (m.dias || []).forEach(d => {
        const existing = porFecha[d.fecha];
        if (!existing || (m.generadoEn || '') > (existing._menuGeneradoEn || '')) {
          porFecha[d.fecha] = { ...d, _menuGeneradoEn: m.generadoEn };
        }
      });
    });
    return Object.values(porFecha).sort((a,b) => a.fecha.localeCompare(b.fecha));
  }

  // ── Calendario horizontal ────────────────────────────────────────

  function _buildCalendario(dias) {
    const config = App.getState().config || {};
    const tieneBebe = (config.personas || []).some(p => p.tipo === 'bebe');
    const hoy = Dates.today();

    // Agrupa por semana (lunes–domingo) para separadores visuales
    const semanas = _agruparPorSemana(dias);

    let html = `<div class="menu-cal">`;

    // Columna de cabeceras izquierda (fija)
    html += `
      <div class="menu-cal-labels">
        <div class="menu-cal-label-header"></div>
        <div class="menu-cal-bloque-label">
          <span class="menu-cal-momento-label">Comida</span>
          <div class="menu-cal-perfiles">
            <span>Adultos</span>
            ${tieneBebe ? '<span>Bebé</span>' : ''}
          </div>
        </div>
        <div class="menu-cal-bloque-label">
          <span class="menu-cal-momento-label">Cena</span>
          <div class="menu-cal-perfiles">
            <span>Adultos</span>
            ${tieneBebe ? '<span>Bebé</span>' : ''}
          </div>
        </div>
      </div>`;

    // Columnas de días (scrollables)
    html += `<div class="menu-cal-scroll" id="menu-cal-scroll">`;

    semanas.forEach((semana, si) => {
      semana.forEach(dia => {
        const esHoy = dia.fecha === hoy;
        const esFinde = ['Sábado','Domingo'].includes(Dates.dayName(dia.fecha));

        html += `<div class="menu-cal-col ${esHoy?'menu-cal-col--hoy':''} ${esFinde?'menu-cal-col--finde':''}">`;

        // Cabecera del día
        html += `
          <div class="menu-cal-dia-header">
            <span class="menu-cal-dia-nombre">${Dates.dayShort(dia.fecha)}</span>
            <span class="menu-cal-dia-num">${Dates.fromISO(dia.fecha).getDate()}</span>
            <span class="menu-cal-dia-mes">${Dates.format(dia.fecha,'short').split(' ')[2]||''}</span>
            ${esHoy ? '<span class="menu-cal-hoy-dot"></span>' : ''}
          </div>`;

        // Bloque comida
        html += _buildBloqueCalendario(dia, 'comida', tieneBebe);
        // Bloque cena
        html += _buildBloqueCalendario(dia, 'cena', tieneBebe);

        html += `</div>`; // .menu-cal-col
      });

      // Separador de semana (excepto el último)
      if (si < semanas.length - 1) {
        html += `<div class="menu-cal-sep-semana"></div>`;
      }
    });

    html += `</div>`; // .menu-cal-scroll
    html += `</div>`; // .menu-cal

    return html;
  }

  function _buildBloqueCalendario(dia, momento, tieneBebe) {
    const bloque = dia[momento];
    let html = `<div class="menu-cal-bloque">`;

    if (!bloque || !bloque.activo) {
      html += `<div class="menu-cal-perfil menu-cal-perfil--esp"><span>—</span></div>`;
      if (tieneBebe) html += `<div class="menu-cal-perfil menu-cal-perfil--esp"><span>—</span></div>`;
    } else {
      // Adultos
      const plMay = (bloque.platosMayores || []).map(p => p.nombre).join(' + ') || '–';
      html += `<div class="menu-cal-perfil">${UI.escapeHtml(plMay)}</div>`;
      // Bebé
      if (tieneBebe) {
        if (bloque.platosBebe === null) {
          html += `<div class="menu-cal-perfil menu-cal-perfil--esp"><span>—</span></div>`;
        } else {
          const plBebe = (bloque.platosBebe || []).map(p => p.nombre).join(' + ') || '–';
          html += `<div class="menu-cal-perfil menu-cal-perfil--bebe">${UI.escapeHtml(plBebe)}</div>`;
        }
      }
    }

    html += `</div>`;
    return html;
  }

  function _agruparPorSemana(dias) {
    const semanas = [];
    let semanaActual = [];
    let lunesActual = null;

    dias.forEach(d => {
      const lunes = Dates.startOfWeek(d.fecha);
      if (lunes !== lunesActual) {
        if (semanaActual.length) semanas.push(semanaActual);
        semanaActual = [];
        lunesActual = lunes;
      }
      semanaActual.push(d);
    });
    if (semanaActual.length) semanas.push(semanaActual);
    return semanas;
  }

  // ── Asistente ────────────────────────────────────────────────────

  function _iniciarAsistente() {
    _menuEnCurso = {
      id: `menu-${Date.now()}`,
      fechaInicio: Dates.tomorrow(),
      fechaFin:    Dates.addDays(Dates.tomorrow(), 6),
      numSemanas:  1,
      dias:        [],
      estado:      'borrador',
      generadoEn:  null,
      confirmadoEn:null,
    };
    _paso = 1;
    _renderAsistente();
  }

  function _renderAsistente() {
    const view = document.getElementById('view-menu');
    if (!view) return;
    const pasos = ['','Horizonte','Días especiales','Inventario','Generando','Calendario'];

    view.innerHTML = `
      <div class="menu-asistente">
        <div class="menu-asist-header">
          ${_paso>1&&_paso<5
            ? `<button class="btn-icon" id="menu-btn-back" style="color:var(--color-text)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg>
               </button>` : ''}
          <h1 class="module-title" style="flex:1">
            ${_paso<5?`Paso ${_paso} de 4 — ${pasos[_paso]}`:'Menú generado'}
          </h1>
          <button class="btn-text" id="menu-btn-cancelar">Cancelar</button>
        </div>
        ${_paso<5?`
          <div class="menu-progress">
            ${[1,2,3,4].map(p=>`<div class="menu-progress-step ${p<_paso?'done':p===_paso?'active':''}"></div>${p<4?'<div class="menu-progress-line"></div>':''}`).join('')}
          </div>`:'' }
        <div id="menu-paso-content">${_renderPaso()}</div>
      </div>`;

    document.getElementById('menu-btn-back')?.addEventListener('click', ()=>{ _paso--; _renderAsistente(); });
    document.getElementById('menu-btn-cancelar')?.addEventListener('click', ()=>{ _paso=0; _renderVista(); });
    _bindPasoEvents();
  }

  function _renderPaso() {
    switch(_paso) {
      case 1: return _renderPaso1();
      case 2: return _renderPaso2();
      case 3: return _renderPaso3();
      case 4: return _renderPaso4Generando();
      case 5: return _renderPaso5Tabla();
      default: return '';
    }
  }

  // ── Paso 1: Horizonte ────────────────────────────────────────────

  function _renderPaso1() {
    return `
      <div class="menu-paso">
        <p class="menu-paso-desc">¿A partir de cuándo y cuántas semanas?</p>
        <div class="form-group">
          <label class="form-label">Fecha de inicio</label>
          <input class="form-control" id="menu-fecha-inicio" type="date"
                 value="${_menuEnCurso.fechaInicio}" min="${Dates.today()}"/>
          <p class="form-hint">Seleccionado: <strong id="menu-fecha-display">${Dates.format(_menuEnCurso.fechaInicio,'long')}</strong></p>
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
    const config = App.getState().config || {};
    const tipos  = config.tiposDiaEspecial || [];
    const numDias = _menuEnCurso.numSemanas * 7;
    const dias   = Dates.range(_menuEnCurso.fechaInicio, numDias);

    return `
      <div class="menu-paso">
        <p class="menu-paso-desc">Marca los días que no comerás o cenarás en casa.</p>
        ${tipos.length===0?`<div class="card card-empty"><p class="text-sm">No tienes días especiales configurados.<br>Añádelos en <strong>Config → Días especiales</strong>.</p></div>`:''}
        <div class="menu-dias-especiales">
          ${dias.map(fecha=>{
            const diaSem = Dates.dayName(fecha);
            const esFinde = ['Sábado','Domingo'].includes(diaSem);
            const esp = (_menuEnCurso.dias.find(d=>d.fecha===fecha)||{}).tipoEspecial||'';
            return `
              <div class="menu-dia-esp-row ${esFinde?'menu-dia-finde':''}">
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
    const { inventario } = App.getState();
    const items = inventario || [];
    const urgentes = items.filter(i => {
      const s = Dates.expiryStatus(i.fechaCaducidad);
      return s==='expired'||s==='urgent'||i.forzarUso;
    });

    return `
      <div class="menu-paso">
        <p class="menu-paso-desc">Revisa el inventario y fuerza el uso de artículos concretos si quieres.</p>
        ${urgentes.length>0?`
          <div class="menu-inv-alertas">
            <h3 class="section-title">⚠ Requieren atención</h3>
            ${urgentes.map(item=>{
              const s=Dates.expiryStatus(item.fechaCaducidad);
              return `
                <div class="list-item" style="margin-bottom:var(--space-2)">
                  <div class="list-item-content">
                    <div class="list-item-title">${UI.escapeHtml(item.nombre)}</div>
                    <div class="list-item-subtitle">
                      ${s==='expired'?'<span class="badge badge-red">Caducado</span>':
                        s==='urgent'?`<span class="badge badge-orange">Caduca en ${Dates.daysUntil(item.fechaCaducidad)}d</span>`:''}
                      ${item.forzarUso?'<span class="badge badge-blue">⭐ Forzado</span>':''}
                      ${item.ubicacion==='congelador'?'🧊':''}
                    </div>
                  </div>
                  <button class="btn btn-secondary btn-sm menu-toggle-forzar"
                          data-id="${item.id}"
                          style="${item.forzarUso?'background:var(--color-primary-light);color:var(--color-primary)':''}">
                    ${item.forzarUso?'⭐ Forzado':'⭐ Usar'}
                  </button>
                </div>`}).join('')}
          </div>`:
          `<div class="card card-empty" style="padding:var(--space-6)">
            <p class="text-sm">✓ Sin artículos urgentes.</p>
          </div>`}
        <div class="menu-paso-footer" style="display:flex;flex-direction:column;gap:var(--space-3)">
          <button class="btn btn-primary btn-full" id="menu-paso3-next">Generar menú →</button>
          <button class="btn btn-secondary btn-full" id="menu-paso3-skip">Omitir</button>
        </div>
      </div>`;
  }

  // ── Paso 4: Generando ────────────────────────────────────────────

  function _renderPaso4Generando() {
    setTimeout(_generarMenu, 100);
    return `
      <div class="menu-paso" style="text-align:center;padding:var(--space-12) 0">
        <div class="loading-spinner" style="margin:0 auto var(--space-6)"></div>
        <p class="loading-message" id="menu-gen-msg">Analizando inventario...</p>
      </div>`;
  }

  // ── Paso 5: Tabla editable ───────────────────────────────────────

  function _renderPaso5Tabla() {
    if (!_menuEnCurso?.dias?.length) return '<p>Error: sin datos de menú.</p>';
    const config = App.getState().config || {};
    const tieneBebe = (config.personas||[]).some(p=>p.tipo==='bebe');
    const diasCombinados = _combinarDiasDeMenus([_menuEnCurso]);

    return `
      <div class="menu-paso-tabla">
        <p class="text-sm text-muted" style="margin-bottom:var(--space-3)">
          Pulsa cualquier celda para cambiar el plato.
        </p>

        <!-- Panel de consulta rápida -->
        <div class="menu-info-panels">
          <button class="btn btn-secondary btn-sm" id="menu-panel-inv-btn">📦 Ver inventario</button>
        </div>
        <div id="menu-panel-inv" class="menu-info-panel hidden"></div>

        <div class="menu-calendario-wrapper" style="margin-top:var(--space-3)">
          ${_buildCalendarioEditable(diasCombinados, tieneBebe)}
        </div>

        <div class="menu-paso-footer" style="margin-top:var(--space-6)">
          <button class="btn btn-primary btn-full" id="menu-btn-confirmar">
            ✓ Confirmar menú
          </button>
        </div>
      </div>`;
  }

  function _buildCalendarioEditable(dias, tieneBebe) {
    const hoy = Dates.today();
    const semanas = _agruparPorSemana(dias);

    let html = `<div class="menu-cal">`;
    html += `
      <div class="menu-cal-labels">
        <div class="menu-cal-label-header"></div>
        <div class="menu-cal-bloque-label">
          <span class="menu-cal-momento-label">Comida</span>
          <div class="menu-cal-perfiles">
            <span>Adultos</span>
            ${tieneBebe ? '<span>Bebé</span>' : ''}
          </div>
        </div>
        <div class="menu-cal-bloque-label">
          <span class="menu-cal-momento-label">Cena</span>
          <div class="menu-cal-perfiles">
            <span>Adultos</span>
            ${tieneBebe ? '<span>Bebé</span>' : ''}
          </div>
        </div>
      </div>`;

    html += `<div class="menu-cal-scroll">`;
    semanas.forEach((semana, si) => {
      semana.forEach(dia => {
        const esHoy = dia.fecha === hoy;
        const esFinde = ['Sábado','Domingo'].includes(Dates.dayName(dia.fecha));

        html += `<div class="menu-cal-col ${esHoy?'menu-cal-col--hoy':''} ${esFinde?'menu-cal-col--finde':''}">`;
        html += `
          <div class="menu-cal-dia-header">
            <span class="menu-cal-dia-nombre">${Dates.dayShort(dia.fecha)}</span>
            <span class="menu-cal-dia-num">${Dates.fromISO(dia.fecha).getDate()}</span>
            <span class="menu-cal-dia-mes">${Dates.format(dia.fecha,'short').split(' ')[2]||''}</span>
          </div>`;

        ['comida','cena'].forEach(momento => {
          html += `<div class="menu-cal-bloque">`;
          const bloque = dia[momento];

          if (!bloque?.activo) {
            html += `<div class="menu-cal-perfil menu-cal-perfil--esp">—</div>`;
            if (tieneBebe) html += `<div class="menu-cal-perfil menu-cal-perfil--esp">—</div>`;
          } else {
            // Adultos — editable
            const plMay = (bloque.platosMayores||[]).map(p=>p.nombre).join(' + ') || '+';
            html += `<div class="menu-cal-perfil menu-cal-perfil--edit"
                          data-fecha="${dia.fecha}" data-momento="${momento}" data-perfil="mayores" data-fila="0">
                       ${UI.escapeHtml(plMay)}
                     </div>`;
            // Bebé
            if (tieneBebe) {
              if (bloque.platosBebe === null) {
                html += `<div class="menu-cal-perfil menu-cal-perfil--esp">—</div>`;
              } else {
                const plBebe = (bloque.platosBebe||[]).map(p=>p.nombre).join(' + ') || '+';
                html += `<div class="menu-cal-perfil menu-cal-perfil--edit menu-cal-perfil--bebe"
                              data-fecha="${dia.fecha}" data-momento="${momento}" data-perfil="bebe" data-fila="0">
                           ${UI.escapeHtml(plBebe)}
                         </div>`;
              }
            }
          }
          html += `</div>`;
        });

        html += `</div>`;
      });
      if (si < semanas.length-1) html += `<div class="menu-cal-sep-semana"></div>`;
    });
    html += `</div></div>`;
    return html;
  }

  // ── Motor de generación ──────────────────────────────────────────

  async function _generarMenu() {
    const state = App.getState();
    const { platos, inventario, config } = state;
    const platosActivos = (platos||[]).filter(p=>p.activo!==false);

    _setGenMsg('Cargando historial...');
    const historial = await _cargarHistorialReciente(4);

    _setGenMsg('Construyendo días...');
    const numDias = _menuEnCurso.numSemanas * 7;
    const diasFechas = Dates.range(_menuEnCurso.fechaInicio, numDias);
    const tieneBebe  = (config?.personas||[]).some(p=>p.tipo==='bebe');

    const dias = diasFechas.map(fecha => {
      const diaExistente = _menuEnCurso.dias.find(d=>d.fecha===fecha);
      const tipoEspecialId = diaExistente?.tipoEspecial || null;
      const tipoEspecial = tipoEspecialId
        ? (config?.tiposDiaEspecial||[]).find(t=>t.id===tipoEspecialId)
        : null;

      // ── CORRECCIÓN días especiales ──
      // Cada momento y perfil se evalúa independientemente según afectaA
      const afectaA = tipoEspecial?.afectaA || 'todos';

      const comidaMayoresActiva = !tipoEspecial?.afectaComida ||
        (afectaA === 'bebe');  // si solo afecta al bebé, adultos siguen activos

      const comidaBebeActiva = !tipoEspecial?.afectaComida ||
        (afectaA === 'mayores'); // si solo afecta a mayores, bebé sigue activo

      const cenaMayoresActiva = !tipoEspecial?.afectaCena ||
        (afectaA === 'bebe');

      const cenaBebeActiva = !tipoEspecial?.afectaCena ||
        (afectaA === 'mayores');

      return {
        fecha,
        diaSemana: Dates.dayName(fecha),
        tipoEspecial: tipoEspecialId,
        comida: {
          activo: comidaMayoresActiva || (tieneBebe && comidaBebeActiva),
          platosMayores: comidaMayoresActiva ? [] : null,
          platosBebe:    tieneBebe ? (comidaBebeActiva ? [] : null) : null,
        },
        cena: {
          activo: cenaMayoresActiva || (tieneBebe && cenaBebeActiva),
          platosMayores: cenaMayoresActiva ? [] : null,
          platosBebe:    tieneBebe ? (cenaBebeActiva ? [] : null) : null,
        },
      };
    });

    _setGenMsg('Aplicando reglas...');
    const artsPrioritarios = (inventario||[])
      .filter(i=>i.forzarUso||['urgent','expired'].includes(Dates.expiryStatus(i.fechaCaducidad)))
      .map(i=>i.nombre.toLowerCase());

    const usadosSemana = new Set();
    const usadosReciente = _buildUsadosReciente(historial);
    const proteinasPorDia = {};

    for (let di=0; di<dias.length; di++) {
      const dia = dias[di];
      for (const momento of ['comida','cena']) {
        const bloque = dia[momento];
        if (!bloque?.activo) continue;

        // Genera para adultos
        if (bloque.platosMayores !== null) {
          const cands = _filtrarCandidatos({
            platos:platosActivos, tipoMenu:'mayores', momento,
            usadosSemana, usadosReciente, artsPrioritarios,
            proteinasPorDia, diaIndex:di, esCena:momento==='cena',
            cfgMenus: config?.configuracionMenus,
          });
          const p = _elegirPlato(cands, artsPrioritarios, inventario||[]);
          if (p) {
            bloque.platosMayores = [{id:p.id,nombre:p.nombre}];
            if (!p.permiteRepeticion) usadosSemana.add(p.id);
            _registrarProteina(proteinasPorDia, di, p);
          }
        }

        // Genera para bebé
        if (tieneBebe && bloque.platosBebe !== null) {
          const cands = _filtrarCandidatos({
            platos:platosActivos, tipoMenu:'bebe', momento,
            usadosSemana, usadosReciente, artsPrioritarios,
            proteinasPorDia, diaIndex:di, esCena:momento==='cena',
            cfgMenus: config?.configuracionMenus,
          });
          const p = _elegirPlato(cands, artsPrioritarios, inventario||[]);
          if (p) {
            bloque.platosBebe = [{id:p.id,nombre:p.nombre}];
          } else if (bloque.platosMayores?.length) {
            bloque.platosBebe = bloque.platosMayores; // fallback
          }
        }
      }
    }

    // ── Combinar con menús existentes ──
    // Los días del nuevo menú sobreescriben los existentes
    _menuEnCurso.dias = dias;
    _menuEnCurso.generadoEn = new Date().toISOString();

    _setGenMsg('¡Listo!');
    await new Promise(r=>setTimeout(r,500));
    _paso=5;
    _renderAsistente();
  }

  // ── Helpers motor ────────────────────────────────────────────────

  function _filtrarCandidatos({ platos, tipoMenu, momento, usadosSemana, usadosReciente,
    artsPrioritarios, proteinasPorDia, diaIndex, esCena, soloTipo, cfgMenus }) {

    const equilibrioCC  = cfgMenus?.equilibrioComidaCena  !== false;
    const equilibrioProt= cfgMenus?.equilibrioProteinas   !== false;

    return platos.filter(p => {
      if (tipoMenu==='bebe'    && !p.tipoMenu?.includes('bebe')    && !p.tipoMenu?.includes('todos')) return false;
      if (tipoMenu==='mayores' && !p.tipoMenu?.includes('mayores') && !p.tipoMenu?.includes('todos')) return false;
      if (soloTipo && p.tipoPlato!==soloTipo) return false;
      if (!soloTipo && p.tipoPlato==='segundo') return false;
      const mOk = p.tipoComida?.includes(momento)||p.tipoComida?.includes('ambos');
      if (!mOk) return false;
      if (!p.permiteRepeticion && usadosSemana.has(p.id)) return false;
      const minSem = p.frecuenciaMinSemanas||2;
      if (usadosReciente[p.id]&&usadosReciente[p.id]<minSem) return false;
      if (equilibrioCC && esCena) {
        const etqs=(p.etiquetas||[]).map(e=>e.toLowerCase());
        if (etqs.some(e=>['legumbre','guiso','cocido','paella','fabada'].includes(e))) return false;
      }
      if (equilibrioProt && diaIndex>=2) {
        const prot=_detectarProteina(p);
        if (prot&&proteinasPorDia[diaIndex-1]===prot&&proteinasPorDia[diaIndex-2]===prot) return false;
      }
      return true;
    });
  }

  function _elegirPlato(candidatos, artsPrioritarios, inventario) {
    if (!candidatos.length) return null;
    const puntuados = candidatos.map(p => {
      let score = Math.random()*10;
      const ingNames = (p.ingredientes||[]).map(i=>(i.nombre||'').toLowerCase());
      score += ingNames.filter(n=>artsPrioritarios.includes(n)).length*20;
      return {plato:p, score};
    });
    return puntuados.sort((a,b)=>b.score-a.score)[0].plato;
  }

  function _detectarProteina(plato) {
    const etqs=(plato.etiquetas||[]).map(e=>e.toLowerCase());
    const nombre=plato.nombre.toLowerCase();
    for (const [tipo,palabras] of Object.entries(ETIQUETAS_PROTEINA)) {
      if (palabras.some(p=>etqs.includes(p)||nombre.includes(p))) return tipo;
    }
    return null;
  }

  function _registrarProteina(registro, diaIndex, plato) {
    const prot=_detectarProteina(plato);
    if (prot) registro[diaIndex]=prot;
  }

  function _buildUsadosReciente(historial) {
    const res={};
    historial.forEach((menu,semIdx)=>{
      const sem=semIdx+1;
      (menu.dias||[]).forEach(d=>{
        ['comida','cena'].forEach(m=>{
          [...(d[m]?.platosMayores||[]),...(d[m]?.platosBebe||[])].forEach(p=>{
            if (!res[p.id]||res[p.id]>sem) res[p.id]=sem;
          });
        });
      });
    });
    return res;
  }

  async function _cargarHistorialReciente(n) {
    try {
      const arch=await Drive.listMenuFiles();
      const menus=[];
      for (const f of arch.slice(0,n)) {
        const m=await Drive.readMenuJson(f.id).catch(()=>null);
        if(m) menus.push(m);
      }
      return menus;
    } catch { return []; }
  }

  function _setGenMsg(msg) {
    const el=document.getElementById('menu-gen-msg');
    if(el) el.textContent=msg;
  }

  // ── Confirmar ────────────────────────────────────────────────────

  async function _confirmarMenu() {
    const btn=document.getElementById('menu-btn-confirmar');
    if(btn){btn.disabled=true;btn.textContent='Guardando...';}

    _menuEnCurso.estado='confirmado';
    _menuEnCurso.confirmadoEn=new Date().toISOString();

    const fileName=`semana_${_menuEnCurso.fechaInicio}.json`;
    await Drive.writeMenuJson(fileName, _menuEnCurso);

    const notifs=Notificaciones.generarParaMenu(_menuEnCurso);
    const config={...(App.getState().config||{})};
    if(!config.notificaciones) config.notificaciones={};
    config.notificaciones.pendientes=notifs;
    await App.setState('config',config);

    App.getState().menuActual=_menuEnCurso;
    UI.showToast('Menú confirmado ✓','success',2000);
    await new Promise(r=>setTimeout(r,1000));
    App.navigate('compra');
  }

  // ── Popup selección plato ────────────────────────────────────────

  function _abrirPopupPlato(fecha, momento, perfil, fila) {
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
        <input type="search" id="popup-plato-search" placeholder="Buscar plato..." autocomplete="off"/>
      </div>
      <div id="popup-plato-list" class="popup-plato-list">${_buildPopupPlatos(compatibles,'')}</div>`;

    const modal=UI.showModal({
      title:`Seleccionar — ${momento==='comida'?'Comida':'Cena'} · ${perfil==='bebe'?'Bebé':'Adultos'}`,
      content:container,
    });

    setTimeout(()=>{
      const inp=document.getElementById('popup-plato-search');
      inp?.focus();
      inp?.addEventListener('input',e=>{
        const f=e.target.value.toLowerCase();
        const list=document.getElementById('popup-plato-list');
        if(list) list.innerHTML=_buildPopupPlatos(compatibles,f);
        _bindPopupPlatos(fecha,momento,perfil,fila,modal);
      });
      _bindPopupPlatos(fecha,momento,perfil,fila,modal);
    },100);
  }

  function _buildPopupPlatos(platos, filtro) {
    const f=filtro?platos.filter(p=>p.nombre.toLowerCase().includes(filtro)):platos;
    if(!f.length) return `<p class="text-sm text-muted" style="padding:var(--space-4)">Sin resultados.</p>`;
    return f.sort((a,b)=>a.nombre.localeCompare(b.nombre,'es')).map(p=>`
      <button class="popup-plato-item" data-id="${p.id}" data-nombre="${UI.escapeHtml(p.nombre)}">
        <span class="popup-plato-nombre">${UI.escapeHtml(p.nombre)}</span>
        <span class="popup-plato-meta">
          ${{unico:'Único',primero:'1º',segundo:'2º'}[p.tipoPlato]||''}
          ${(p.etiquetas||[]).slice(0,2).map(e=>`<span class="pl-etiqueta">${UI.escapeHtml(e)}</span>`).join('')}
        </span>
      </button>`).join('');
  }

  function _bindPopupPlatos(fecha,momento,perfil,fila,modal) {
    document.querySelectorAll('.popup-plato-item').forEach(btn=>{
      btn.addEventListener('click',()=>{
        _asignarPlato(fecha,momento,perfil,fila,btn.dataset.id,btn.dataset.nombre);
        modal.close();
      });
    });
  }

  function _asignarPlato(fecha,momento,perfil,fila,platoId,platoNombre) {
    const dia=_menuEnCurso.dias.find(d=>d.fecha===fecha);
    if(!dia) return;
    const bloque=dia[momento];
    const arr=perfil==='bebe'?'platosBebe':'platosMayores';
    if(!bloque[arr]) bloque[arr]=[];
    bloque[arr][fila]={id:platoId,nombre:platoNombre};
    // Actualiza celda sin re-renderizar
    const celda=document.querySelector(
      `.menu-cal-perfil--edit[data-fecha="${fecha}"][data-momento="${momento}"][data-perfil="${perfil}"]`
    );
    if(celda) celda.textContent=platoNombre;
  }

  // ── Bind eventos ─────────────────────────────────────────────────

  function _bindPasoEvents() {
    switch(_paso) {
      case 1: _bindPaso1(); break;
      case 2: _bindPaso2(); break;
      case 3: _bindPaso3(); break;
      case 5: _bindPaso5(); break;
    }
  }

  function _bindPaso1() {
    const semanasEl=document.getElementById('menu-semanas-val');
    const displayEl=document.getElementById('menu-fecha-display');

    document.getElementById('menu-semanas-plus')?.addEventListener('click',()=>{
      _menuEnCurso.numSemanas=Math.min(8,_menuEnCurso.numSemanas+1);
      if(semanasEl) semanasEl.textContent=_menuEnCurso.numSemanas;
    });
    document.getElementById('menu-semanas-minus')?.addEventListener('click',()=>{
      _menuEnCurso.numSemanas=Math.max(1,_menuEnCurso.numSemanas-1);
      if(semanasEl) semanasEl.textContent=_menuEnCurso.numSemanas;
    });
    document.getElementById('menu-fecha-inicio')?.addEventListener('change',e=>{
      _menuEnCurso.fechaInicio=e.target.value;
      if(displayEl) displayEl.textContent=Dates.format(e.target.value,'long');
    });
    document.getElementById('menu-paso1-next')?.addEventListener('click',()=>{
      const v=document.getElementById('menu-fecha-inicio')?.value;
      if(v) _menuEnCurso.fechaInicio=v;
      _menuEnCurso.fechaFin=Dates.addDays(_menuEnCurso.fechaInicio,_menuEnCurso.numSemanas*7-1);
      _paso=2;_renderAsistente();
    });
  }

  function _bindPaso2() {
    document.getElementById('menu-paso2-next')?.addEventListener('click',()=>{
      _menuEnCurso.dias=[];
      document.querySelectorAll('.menu-dia-esp-select').forEach(sel=>{
        if(sel.value) _menuEnCurso.dias.push({fecha:sel.dataset.fecha,tipoEspecial:sel.value});
      });
      _paso=3;_renderAsistente();
    });
  }

  function _bindPaso3() {
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

  function _bindPaso5() {
    // Celdas editables
    document.querySelectorAll('.menu-cal-perfil--edit').forEach(td=>{
      td.addEventListener('click',()=>{
        _abrirPopupPlato(td.dataset.fecha,td.dataset.momento,td.dataset.perfil,parseInt(td.dataset.fila||0));
      });
    });

    // Confirmar
    document.getElementById('menu-btn-confirmar')?.addEventListener('click',_confirmarMenu);

    // Panel inventario
    const panelBtn=document.getElementById('menu-panel-inv-btn');
    const panelEl=document.getElementById('menu-panel-inv');
    panelBtn?.addEventListener('click',()=>{
      if(panelEl.classList.contains('hidden')){
        const inv=App.getState().inventario||[];
        panelEl.innerHTML=`
          <div class="menu-panel-content">
            <h3 class="section-title" style="margin-bottom:var(--space-3)">📦 Inventario actual</h3>
            ${inv.length===0?'<p class="text-sm text-muted">Despensa vacía.</p>':
              inv.map(i=>`<div class="menu-panel-item">
                <span>${UI.escapeHtml(i.nombre)}</span>
                <span class="text-xs text-muted">${i.cantidad} ${i.unidad} · ${i.ubicacion}</span>
              </div>`).join('')}
          </div>`;
        panelEl.classList.remove('hidden');
        panelBtn.textContent='📦 Ocultar inventario';
      } else {
        panelEl.classList.add('hidden');
        panelBtn.textContent='📦 Ver inventario';
      }
    });
  }

  // ── Utils ────────────────────────────────────────────────────────

  function _ensureView() {
    if(!document.getElementById('view-menu')){
      const v=document.createElement('div');
      v.id='view-menu';v.className='view';
      document.getElementById('app-content')?.appendChild(v);
    }
  }

  return { render };

})();
