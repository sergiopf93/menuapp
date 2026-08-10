/**
 * MenuApp — Módulo de Generación y Edición de Menú (Fase 3)
 *
 * Flujo:
 *   Paso 1 — Configurar horizonte (fecha inicio + nº semanas)
 *   Paso 2 — Días especiales (opcional)
 *   Paso 3 — Revisión de inventario (opcional)
 *   Paso 4 — Generar menú automáticamente con reglas de negocio
 *   Paso 5 — Editar manualmente cualquier celda
 *   Paso 6 — Confirmar y guardar en Drive
 *
 * Reglas de negocio aplicadas:
 *   RN-01: No repetición dentro de la misma semana
 *   RN-02: Frecuencia mínima entre semanas (por plato)
 *   RN-03: Prioridad por fecha de preferencia de uso (inventario)
 *   RN-04: Prioridad de artículos forzados
 *   RN-05: Compatibilidad bebé/adultos
 *   RN-06: Plato único vs primero+segundo
 *   RN-07: Días especiales
 *   RN-08: Equilibrio de proteínas (no más de 2 días seguidos del mismo tipo)
 *   RN-09: Platos pesados preferentemente a mediodía
 *
 * @module Menu
 */

const Menu = (() => {

  // ── Estado local del módulo ──────────────────────────────────────
  let _paso        = 0;       // Paso actual del asistente (0=lista, 1-5=asistente)
  let _menuEnCurso = null;    // Objeto de menú en construcción
  let _semanaActual= null;    // Menú de la semana actual (cargado de Drive)

  // ── Constantes ───────────────────────────────────────────────────
  const DIAS_SEMANA = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];

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
    const view = document.getElementById('view-menu');
    if (!view) return;
    _paso = 0;
    _renderVista();
  }

  // ── Vista principal (lista de menús + botón nuevo) ───────────────

  async function _renderVista() {
    const view = document.getElementById('view-menu');
    if (!view) return;

    // Carga el menú activo si existe
    const menusEnDrive = await Drive.listMenuFiles().catch(()=>[]);
    const hoy = Dates.today();

    // Busca el menú que incluye hoy
    _semanaActual = null;
    for (const f of menusEnDrive) {
      try {
        const m = await Drive.readMenuJson(f.id);
        if (m && m.fechaInicio <= hoy && m.fechaFin >= hoy && m.estado !== 'historico') {
          _semanaActual = m;
          break;
        }
      } catch { /* continúa */ }
    }

    view.innerHTML = `
      <div class="module-header">
        <h1 class="module-title">Menú</h1>
        <button class="btn btn-primary btn-sm" id="menu-btn-nuevo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Nuevo menú
        </button>
      </div>

      ${_semanaActual
        ? `<div class="menu-semana-activa">
             <h2 class="section-title">📅 Semana actual</h2>
             ${_buildTablaResumen(_semanaActual)}
             <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4)">
               <button class="btn btn-secondary" style="flex:1" id="menu-btn-editar">Editar menú</button>
               <button class="btn btn-primary"   style="flex:1" id="menu-btn-compra">Ir a la compra 🛒</button>
             </div>
           </div>`
        : `<div class="card card-empty">
             <div class="empty-state-icon">📅</div>
             <p>No hay menú para esta semana.</p>
             <button class="btn btn-primary" id="menu-btn-nuevo2">Generar menú de esta semana</button>
           </div>`}
    `;

    document.getElementById('menu-btn-nuevo')?.addEventListener('click', _iniciarAsistente);
    document.getElementById('menu-btn-nuevo2')?.addEventListener('click', _iniciarAsistente);
    document.getElementById('menu-btn-editar')?.addEventListener('click', () => {
      _menuEnCurso = JSON.parse(JSON.stringify(_semanaActual));
      _paso = 5;
      _renderAsistente();
    });
    document.getElementById('menu-btn-compra')?.addEventListener('click', () => {
      App.navigate('compra');
    });
  }

  // ── Tabla resumen del menú activo ────────────────────────────────

  function _buildTablaResumen(menu) {
    const config = App.getState().config;
    const tieneBebe = (config?.personas||[]).some(p=>p.tipo==='bebe');

    return `
      <div class="menu-tabla-scroll">
        <table class="menu-tabla">
          <thead>
            <tr>
              <th class="menu-th-momento"></th>
              ${menu.dias.map(d=>`
                <th class="menu-th-dia ${d.fecha===Dates.today()?'menu-th-hoy':''}">
                  <span class="menu-th-nombre">${d.diaSemana.substring(0,3)}</span>
                  <span class="menu-th-num">${Dates.fromISO(d.fecha).getDate()}</span>
                </th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr class="menu-tr-label"><td colspan="${menu.dias.length+1}">🍽 Comida · Adultos</td></tr>
            ${_buildFilasBloque(menu.dias,'comida','mayores')}
            ${tieneBebe?`
              <tr class="menu-tr-label"><td colspan="${menu.dias.length+1}">👶 Comida · Bebé</td></tr>
              ${_buildFilasBloque(menu.dias,'comida','bebe')}
            `:''}
            <tr class="menu-tr-label"><td colspan="${menu.dias.length+1}">🌙 Cena · Adultos</td></tr>
            ${_buildFilasBloque(menu.dias,'cena','mayores')}
            ${tieneBebe?`
              <tr class="menu-tr-label"><td colspan="${menu.dias.length+1}">👶 Cena · Bebé</td></tr>
              ${_buildFilasBloque(menu.dias,'cena','bebe')}
            `:''}
          </tbody>
        </table>
      </div>`;
  }

  function _buildFilasBloque(dias, momento, perfil) {
    // Determina el máximo de filas (plato único=1, primero+segundo=2)
    let maxFilas = 1;
    dias.forEach(d => {
      const bloque = d[momento];
      const platos = perfil==='bebe' ? bloque?.platosBebe : bloque?.platosMayores;
      if (platos && platos.length > maxFilas) maxFilas = platos.length;
    });

    let html = '';
    for (let fila=0; fila<maxFilas; fila++) {
      html += `<tr>`;
      html += fila===0 ? `<td class="menu-td-rowlabel">${fila===0&&maxFilas>1?'1º':''}</td>` : `<td class="menu-td-rowlabel">2º</td>`;
      dias.forEach(d => {
        const bloque = d[momento];
        if (!bloque?.activo) {
          if (fila===0) html += `<td class="menu-td menu-td-especial" rowspan="${maxFilas}">—</td>`;
          return;
        }
        const platos = perfil==='bebe' ? bloque?.platosBebe : bloque?.platosMayores;
        const plato  = platos?.[fila];
        html += `<td class="menu-td ${!plato?'menu-td-vacio':''}">${plato?UI.escapeHtml(plato.nombre):'–'}</td>`;
      });
      html += `</tr>`;
    }
    return html;
  }

  // ── Asistente: paso a paso ───────────────────────────────────────

  function _iniciarAsistente() {
    const state = App.getState();
    const config = state.config || {};

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

    const pasos = ['','Horizonte','Días especiales','Inventario','Generando','Tabla'];
    const titulo = pasos[_paso] || '';

    view.innerHTML = `
      <div class="menu-asistente">
        <!-- Header del asistente -->
        <div class="menu-asist-header">
          ${_paso > 1 && _paso < 5
            ? `<button class="btn-icon" id="menu-btn-back" style="color:var(--color-text)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
               </button>` : ''}
          <h1 class="module-title" style="flex:1">
            ${_paso < 5 ? `Paso ${_paso} de 4 — ${titulo}` : 'Tabla de menú'}
          </h1>
          <button class="btn-text" id="menu-btn-cancelar">Cancelar</button>
        </div>

        <!-- Barra de progreso -->
        ${_paso < 5 ? `
          <div class="menu-progress">
            ${[1,2,3,4].map(p=>`
              <div class="menu-progress-step ${p<_paso?'done':p===_paso?'active':''}"></div>
            `).join('<div class="menu-progress-line"></div>')}
          </div>` : ''}

        <!-- Contenido del paso -->
        <div id="menu-paso-content">
          ${_renderPaso()}
        </div>
      </div>
    `;

    document.getElementById('menu-btn-back')?.addEventListener('click', () => { _paso--; _renderAsistente(); });
    document.getElementById('menu-btn-cancelar')?.addEventListener('click', () => { _paso=0; _renderVista(); });
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
        <p class="menu-paso-desc">¿A partir de cuándo y cuántas semanas quieres planificar?</p>

        <div class="form-group">
          <label class="form-label" for="menu-fecha-inicio">Fecha de inicio</label>
          <input class="form-control" id="menu-fecha-inicio" type="date"
                 value="${_menuEnCurso.fechaInicio}" min="${Dates.today()}"/>
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
          <button class="btn btn-primary btn-full" id="menu-paso1-next">
            Siguiente — Días especiales →
          </button>
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
        <p class="menu-paso-desc">Marca los días que no comerás o cenarás en casa. El resto se generará con normalidad.</p>

        ${tipos.length === 0
          ? `<div class="card card-empty"><p class="text-sm">No tienes tipos de días especiales configurados.<br>Puedes añadirlos en <strong>Config</strong>.</p></div>`
          : ''
        }

        <div class="menu-dias-especiales" id="menu-dias-esp">
          ${dias.map((fecha, i) => {
            const diaSem = Dates.dayName(fecha);
            const esFinde = diaSem === 'Sábado' || diaSem === 'Domingo';
            const esp = (_menuEnCurso.dias.find(d=>d.fecha===fecha)||{}).tipoEspecial || '';
            return `
              <div class="menu-dia-esp-row ${esFinde?'menu-dia-finde':''}">
                <div class="menu-dia-esp-label">
                  <span class="menu-dia-nombre">${diaSem.substring(0,3)}</span>
                  <span class="menu-dia-fecha">${Dates.fromISO(fecha).getDate()} ${['','ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][Dates.fromISO(fecha).getMonth()+1]}</span>
                </div>
                <select class="form-control menu-dia-esp-select" data-fecha="${fecha}" style="flex:1">
                  <option value="">Normal</option>
                  ${tipos.map(t=>`<option value="${t.id}" ${esp===t.id?'selected':''}>${t.nombre}</option>`).join('')}
                </select>
              </div>`;
          }).join('')}
        </div>

        <div class="menu-paso-footer">
          <button class="btn btn-primary btn-full" id="menu-paso2-next">
            Siguiente — Revisar inventario →
          </button>
        </div>
      </div>`;
  }

  // ── Paso 3: Revisión de inventario ──────────────────────────────

  function _renderPaso3() {
    const { inventario } = App.getState();
    const items = inventario || [];
    const urgentes = items.filter(i => {
      const s = Dates.expiryStatus(i.fechaCaducidad);
      return s === 'expired' || s === 'urgent' || i.forzarUso;
    });

    return `
      <div class="menu-paso">
        <p class="menu-paso-desc">Revisa el inventario antes de generar. Puedes forzar el uso de artículos concretos.</p>

        ${urgentes.length > 0 ? `
          <div class="menu-inv-alertas">
            <h3 class="section-title">⚠ Requieren atención</h3>
            ${urgentes.map(item => {
              const s = Dates.expiryStatus(item.fechaCaducidad);
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
                </div>`;
            }).join('')}
          </div>` : `
          <div class="card card-empty" style="padding:var(--space-6)">
            <p class="text-sm">✓ Inventario en buen estado. Sin artículos urgentes.</p>
          </div>`}

        <div class="menu-paso-footer" style="gap:var(--space-3);display:flex;flex-direction:column">
          <button class="btn btn-primary btn-full" id="menu-paso3-next">
            Generar menú →
          </button>
          <button class="btn btn-secondary btn-full" id="menu-paso3-skip">
            Omitir este paso
          </button>
        </div>
      </div>`;
  }

  // ── Paso 4: Generando ────────────────────────────────────────────

  function _renderPaso4Generando() {
    // Arranca la generación en el siguiente tick para que el spinner se muestre
    setTimeout(_generarMenu, 100);
    return `
      <div class="menu-paso" style="text-align:center;padding:var(--space-12) 0">
        <div class="loading-spinner" style="margin:0 auto var(--space-6)"></div>
        <p class="loading-message" id="menu-gen-msg">Analizando inventario...</p>
      </div>`;
  }

  // ── Paso 5: Tabla editable ───────────────────────────────────────

  function _renderPaso5Tabla() {
    if (!_menuEnCurso?.dias?.length) return '<p>Error: no hay datos de menú.</p>';
    const config = App.getState().config || {};
    const tieneBebe = (config.personas||[]).some(p=>p.tipo==='bebe');

    return `
      <div class="menu-paso-tabla">
        <p class="text-sm text-muted" style="margin-bottom:var(--space-3)">
          Pulsa cualquier celda para cambiar el plato asignado.
        </p>

        ${_buildTablaEditable(tieneBebe)}

        <div class="menu-paso-footer" style="margin-top:var(--space-6)">
          <button class="btn btn-primary btn-full" id="menu-btn-confirmar">
            ✓ Confirmar menú y generar lista de la compra
          </button>
        </div>
      </div>`;
  }

  function _buildTablaEditable(tieneBebe) {
    const dias = _menuEnCurso.dias;
    const bloques = [
      { momento:'comida', perfil:'mayores', label:'🍽 Comida · Adultos' },
      ...(tieneBebe ? [{ momento:'comida', perfil:'bebe', label:'👶 Comida · Bebé' }] : []),
      { momento:'cena', perfil:'mayores', label:'🌙 Cena · Adultos' },
      ...(tieneBebe ? [{ momento:'cena', perfil:'bebe', label:'👶 Cena · Bebé' }] : []),
    ];

    return `
      <div class="menu-tabla-scroll">
        <table class="menu-tabla menu-tabla-editable">
          <thead>
            <tr>
              <th class="menu-th-momento"></th>
              ${dias.map(d=>`
                <th class="menu-th-dia ${d.fecha===Dates.today()?'menu-th-hoy':''}">
                  <span class="menu-th-nombre">${d.diaSemana.substring(0,3)}</span>
                  <span class="menu-th-num">${Dates.fromISO(d.fecha).getDate()}</span>
                  ${d.tipoEspecial?`<span class="menu-th-esp">esp</span>`:''}
                </th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${bloques.map(b => _buildBloqueEditable(dias, b.momento, b.perfil, b.label)).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function _buildBloqueEditable(dias, momento, perfil, label) {
    let maxFilas = 1;
    dias.forEach(d => {
      const bloque = d[momento];
      const platos = perfil==='bebe' ? bloque?.platosBebe : bloque?.platosMayores;
      if (platos && platos.length > maxFilas) maxFilas = platos.length;
    });

    let html = `<tr class="menu-tr-label"><td colspan="${dias.length+1}">${label}</td></tr>`;

    for (let fila=0; fila<maxFilas; fila++) {
      html += `<tr>`;
      html += `<td class="menu-td-rowlabel">${maxFilas>1?(fila===0?'1º':'2º'):''}</td>`;
      dias.forEach(d => {
        const bloque = d[momento];
        if (!bloque?.activo) {
          if (fila===0) html += `<td class="menu-td menu-td-especial" rowspan="${maxFilas}"><span class="menu-td-esp-label">Día especial</span></td>`;
          return;
        }
        const platos = perfil==='bebe' ? bloque?.platosBebe : bloque?.platosMayores;
        const plato  = platos?.[fila];
        html += `
          <td class="menu-td menu-td-editable"
              data-fecha="${d.fecha}" data-momento="${momento}" data-perfil="${perfil}" data-fila="${fila}">
            <span class="menu-td-nombre">${plato?UI.escapeHtml(plato.nombre):'+'}</span>
          </td>`;
      });
      html += `</tr>`;
    }
    return html;
  }

  // ── Motor de generación ──────────────────────────────────────────

  async function _generarMenu() {
    const state = App.getState();
    const { platos, inventario, config } = state;
    const platosActivos = (platos||[]).filter(p=>p.activo!==false);

    _setGenMsg('Cargando historial...');

    // Carga historial para respetar frecuencias mínimas
    const historial = await _cargarHistorialReciente(4); // últimas 4 semanas

    _setGenMsg('Construyendo estructura de días...');

    // Construye la estructura de días
    const numDias = _menuEnCurso.numSemanas * 7;
    const diasFechas = Dates.range(_menuEnCurso.fechaInicio, numDias);
    const tieneBebe  = (config?.personas||[]).some(p=>p.tipo==='bebe');

    const dias = diasFechas.map(fecha => {
      const diaSem = Dates.dayName(fecha);
      // Recupera el tipo especial si el usuario lo asignó en paso 2
      const diaExistente = _menuEnCurso.dias.find(d=>d.fecha===fecha);
      const tipoEspecialId = diaExistente?.tipoEspecial || null;
      const tipoEspecial = tipoEspecialId
        ? (config?.tiposDiaEspecial||[]).find(t=>t.id===tipoEspecialId)
        : null;

      return {
        fecha,
        diaSemana: diaSem,
        tipoEspecial: tipoEspecialId,
        comida: {
          activo: !tipoEspecial?.afectaComida,
          platosMayores: [],
          platosBebe: tieneBebe ? [] : null,
        },
        cena: {
          activo: !tipoEspecial?.afectaCena,
          platosMayores: [],
          platosBebe: tieneBebe ? [] : null,
        },
      };
    });

    _setGenMsg('Aplicando reglas de menú...');

    // Artículos prioritarios (forzados o próximos a caducar)
    const artsPrioritarios = (inventario||[])
      .filter(i => i.forzarUso || ['urgent','expired'].includes(Dates.expiryStatus(i.fechaCaducidad)))
      .map(i => i.nombre.toLowerCase());

    // Registro de platos usados en este menú (RN-01)
    const usadosEnEsteSemana = new Set();
    // Registro de platos usados recientemente del historial (RN-02)
    const usadosReciente = _buildUsadosReciente(historial);
    // Seguimiento de proteínas consecutivas (RN-08)
    const proteinasPorDia = {};

    // Asigna platos a cada bloque
    for (let di=0; di<dias.length; di++) {
      const dia = dias[di];
      const momentos = ['comida','cena'];

      for (const momento of momentos) {
        const bloque = dia[momento];
        if (!bloque.activo) continue;

        // Platos compatibles con este momento y para adultos
        const candidatosMayores = _filtrarCandidatos({
          platos: platosActivos,
          tipoMenu: 'mayores',
          momento,
          usadosSemana: usadosEnEsteSemana,
          usadosReciente,
          artsPrioritarios,
          proteinasPorDia,
          diaIndex: di,
          esCena: momento === 'cena',
        });

        const platoMayor = _elegirPlato(candidatosMayores, artsPrioritarios, inventario||[]);
        if (platoMayor) {
          bloque.platosMayores = [{ id: platoMayor.id, nombre: platoMayor.nombre }];
          usadosEnEsteSemana.add(platoMayor.id);
          _registrarProteina(proteinasPorDia, di, platoMayor);

          // Si es primero, busca un segundo
          if (platoMayor.tipoPlato === 'primero') {
            const candidatosSegundo = _filtrarCandidatos({
              platos: platosActivos,
              tipoMenu: 'mayores',
              momento,
              usadosSemana: usadosEnEsteSemana,
              usadosReciente,
              artsPrioritarios,
              proteinasPorDia,
              diaIndex: di,
              esCena: momento === 'cena',
              soloTipo: 'segundo',
            });
            const segundo = _elegirPlato(candidatosSegundo, artsPrioritarios, inventario||[]);
            if (segundo) {
              bloque.platosMayores.push({ id: segundo.id, nombre: segundo.nombre });
              usadosEnEsteSemana.add(segundo.id);
            }
          }
        }

        // Platos para bebé
        if (bloque.platosBebe !== null && tieneBebe) {
          const candidatosBebe = _filtrarCandidatos({
            platos: platosActivos,
            tipoMenu: 'bebe',
            momento,
            usadosSemana: usadosEnEsteSemana,
            usadosReciente,
            artsPrioritarios,
            proteinasPorDia,
            diaIndex: di,
            esCena: momento === 'cena',
          });
          const platoBebe = _elegirPlato(candidatosBebe, artsPrioritarios, inventario||[]);
          if (platoBebe) {
            bloque.platosBebe = [{ id: platoBebe.id, nombre: platoBebe.nombre }];
          } else {
            // Fallback: usa el mismo que adultos si es compatible
            bloque.platosBebe = bloque.platosMayores;
          }
        }
      }
    }

    _menuEnCurso.dias = dias;
    _menuEnCurso.generadoEn = new Date().toISOString();

    _setGenMsg('¡Menú generado!');
    await new Promise(r => setTimeout(r, 600));

    _paso = 5;
    _renderAsistente();
  }

  // ── Helpers del motor ────────────────────────────────────────────

  function _filtrarCandidatos({ platos, tipoMenu, momento, usadosSemana, usadosReciente,
    artsPrioritarios, proteinasPorDia, diaIndex, esCena, soloTipo }) {

    return platos.filter(p => {
      // RN-05: compatibilidad bebé/adultos
      if (tipoMenu === 'bebe'    && !p.tipoMenu.includes('bebe') && !p.tipoMenu.includes('todos')) return false;
      if (tipoMenu === 'mayores' && !p.tipoMenu.includes('mayores') && !p.tipoMenu.includes('todos')) return false;

      // Tipo de plato
      if (soloTipo && p.tipoPlato !== soloTipo) return false;
      if (!soloTipo && p.tipoPlato === 'segundo') return false; // los segundos solo se buscan explícitamente

      // Tipo de comida (comida/cena/ambos)
      const momentoOk = p.tipoComida.includes(momento) || p.tipoComida.includes('ambos');
      if (!momentoOk) return false;

      // RN-01: no repetir en esta semana SALVO que el plato lo permita explícitamente
      if (!p.permiteRepeticion && usadosSemana.has(p.id)) return false;

      // RN-02: frecuencia mínima entre semanas
      const minSem = p.frecuenciaMinSemanas || 2;
      if (usadosReciente[p.id] && usadosReciente[p.id] < minSem) return false;

      // RN-09: platos "pesados" (legumbre, guiso) preferentemente a mediodía
      if (esCena) {
        const etqs = (p.etiquetas||[]).map(e=>e.toLowerCase());
        if (etqs.some(e=>['legumbre','guiso','cocido','paella','fabada'].includes(e))) return false;
      }

      // RN-08: no más de 2 días consecutivos del mismo tipo de proteína
      const proteina = _detectarProteina(p);
      if (proteina && diaIndex >= 2) {
        const p1 = proteinasPorDia[diaIndex-1];
        const p2 = proteinasPorDia[diaIndex-2];
        if (p1 === proteina && p2 === proteina) return false;
      }

      return true;
    });
  }

  function _elegirPlato(candidatos, artsPrioritarios, inventario) {
    if (!candidatos.length) return null;

    // Puntúa cada candidato
    const puntuados = candidatos.map(p => {
      let score = Math.random() * 10; // base aleatoria

      // Bonus por ingredientes prioritarios (RN-03 y RN-04)
      const ingNames = (p.ingredientes||[]).map(i=>i.nombre?.toLowerCase()||'');
      const matchPrio = ingNames.filter(n => artsPrioritarios.includes(n)).length;
      score += matchPrio * 20;

      return { plato: p, score };
    });

    puntuados.sort((a,b) => b.score - a.score);
    return puntuados[0].plato;
  }

  function _detectarProteina(plato) {
    const etqs = (plato.etiquetas||[]).map(e=>e.toLowerCase());
    const nombre = plato.nombre.toLowerCase();
    for (const [tipo, palabras] of Object.entries(ETIQUETAS_PROTEINA)) {
      if (palabras.some(p => etqs.includes(p) || nombre.includes(p))) return tipo;
    }
    return null;
  }

  function _registrarProteina(registro, diaIndex, plato) {
    const proteina = _detectarProteina(plato);
    if (proteina) registro[diaIndex] = proteina;
  }

  function _buildUsadosReciente(historial) {
    // Devuelve { platoId: semanasDesdeUso }
    const resultado = {};
    historial.forEach((menu, semIdx) => {
      const semanasAtras = semIdx + 1;
      (menu.dias||[]).forEach(d => {
        ['comida','cena'].forEach(m => {
          const platos = [
            ...(d[m]?.platosMayores||[]),
            ...(d[m]?.platosBebe||[]),
          ];
          platos.forEach(p => {
            if (!resultado[p.id] || resultado[p.id] > semanasAtras) {
              resultado[p.id] = semanasAtras;
            }
          });
        });
      });
    });
    return resultado;
  }

  async function _cargarHistorialReciente(numSemanas) {
    try {
      const archivos = await Drive.listMenuFiles();
      const menus = [];
      for (const f of archivos.slice(0, numSemanas)) {
        const m = await Drive.readMenuJson(f.id).catch(()=>null);
        if (m) menus.push(m);
      }
      return menus;
    } catch { return []; }
  }

  function _setGenMsg(msg) {
    const el = document.getElementById('menu-gen-msg');
    if (el) el.textContent = msg;
  }

  // ── Confirmar menú ───────────────────────────────────────────────

  async function _confirmarMenu() {
    const btn = document.getElementById('menu-btn-confirmar');
    if (btn) { btn.disabled=true; btn.textContent='Guardando...'; }

    _menuEnCurso.estado       = 'confirmado';
    _menuEnCurso.confirmadoEn = new Date().toISOString();

    // Nombre del fichero: semana_YYYY-MM-DD.json
    const fileName = `semana_${_menuEnCurso.fechaInicio}.json`;
    await Drive.writeMenuJson(fileName, _menuEnCurso);

    // Programa las notificaciones previas
    await _programarNotificaciones(_menuEnCurso);

    UI.showToast('Menú confirmado ✓ Generando lista de la compra...','success', 3000);

    // Guarda el menú en el estado local para que Compra lo use
    App.getState().menuActual = _menuEnCurso;

    await new Promise(r => setTimeout(r, 1500));
    App.navigate('compra');
  }

  async function _programarNotificaciones(menu) {
    try {
      const state = App.getState();
      const platos = state.platos || [];
      const notifs = [];

      menu.dias.forEach(dia => {
        ['comida','cena'].forEach(momento => {
          const bloque = dia[momento];
          if (!bloque?.activo) return;
          const todosPlatos = [...(bloque.platosMayores||[]), ...(bloque.platosBebe||[])];
          const ids = [...new Set(todosPlatos.map(p=>p.id))];
          ids.forEach(id => {
            const plato = platos.find(p=>p.id===id);
            if (plato?.notificacionPrevia) {
              const fechaHora = new Date(dia.fecha + 'T' + (momento==='comida'?'14:00':'21:00'));
              fechaHora.setHours(fechaHora.getHours() - (plato.horasNotificacionPrevia||16));
              notifs.push({
                id: `notif-${plato.id}-${dia.fecha}-${momento}`,
                title: `Recuerda: ${plato.nombre}`,
                body:  plato.notificacionPrevia,
                scheduledAt: fechaHora.toISOString(),
              });
            }
          });
        });
      });

      // Guarda en config
      const config = { ...(state.config||{}) };
      if (!config.notificaciones) config.notificaciones = {};
      config.notificaciones.pendientes = notifs;
      await App.setState('config', config);
    } catch { /* no crítico */ }
  }

  // ── Popup de selección de plato ──────────────────────────────────

  function _abrirPopupPlato(fecha, momento, perfil, fila) {
    const state   = App.getState();
    const platosActivos = (state.platos||[]).filter(p=>p.activo!==false);

    // Filtra por compatibilidad
    const compatibles = platosActivos.filter(p => {
      const momentoOk = p.tipoComida.includes(momento) || p.tipoComida.includes('ambos');
      const perfilOk  = perfil==='bebe'
        ? p.tipoMenu.includes('bebe') || p.tipoMenu.includes('todos')
        : p.tipoMenu.includes('mayores') || p.tipoMenu.includes('todos');
      const tipoOk = fila===0
        ? p.tipoPlato !== 'segundo'
        : p.tipoPlato === 'segundo';
      return momentoOk && perfilOk && tipoOk;
    });

    let filtro = '';

    const container = document.createElement('div');
    container.innerHTML = `
      <div class="search-bar" style="margin-bottom:var(--space-3)">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input type="search" id="popup-plato-search" placeholder="Buscar plato..." autocomplete="off"/>
      </div>
      <div id="popup-plato-list" class="popup-plato-list">
        ${_buildPopupPlatos(compatibles, '')}
      </div>`;

    const modal = UI.showModal({
      title: `Seleccionar plato — ${momento} · ${perfil==='bebe'?'Bebé':'Adultos'}`,
      content: container,
    });

    setTimeout(() => {
      const searchInput = document.getElementById('popup-plato-search');
      searchInput?.focus();
      searchInput?.addEventListener('input', (e) => {
        filtro = e.target.value.toLowerCase();
        const list = document.getElementById('popup-plato-list');
        if (list) list.innerHTML = _buildPopupPlatos(compatibles, filtro);
        _bindPopupPlatos(fecha, momento, perfil, fila, modal);
      });
      _bindPopupPlatos(fecha, momento, perfil, fila, modal);
    }, 100);
  }

  function _buildPopupPlatos(platos, filtro) {
    const filtrados = filtro
      ? platos.filter(p => p.nombre.toLowerCase().includes(filtro))
      : platos;

    if (!filtrados.length) return `<p class="text-sm text-muted" style="padding:var(--space-4)">Sin resultados.</p>`;

    return filtrados
      .sort((a,b) => a.nombre.localeCompare(b.nombre,'es'))
      .map(p => `
        <button class="popup-plato-item" data-id="${p.id}" data-nombre="${UI.escapeHtml(p.nombre)}">
          <span class="popup-plato-nombre">${UI.escapeHtml(p.nombre)}</span>
          <span class="popup-plato-meta">
            ${{unico:'Único',primero:'1º',segundo:'2º'}[p.tipoPlato]||''}
            ${(p.etiquetas||[]).slice(0,2).map(e=>`<span class="pl-etiqueta">${UI.escapeHtml(e)}</span>`).join('')}
          </span>
        </button>`).join('');
  }

  function _bindPopupPlatos(fecha, momento, perfil, fila, modal) {
    document.querySelectorAll('.popup-plato-item').forEach(btn => {
      btn.addEventListener('click', () => {
        _asignarPlato(fecha, momento, perfil, fila, btn.dataset.id, btn.dataset.nombre);
        modal.close();
      });
    });
  }

  function _asignarPlato(fecha, momento, perfil, fila, platoId, platoNombre) {
    const dia = _menuEnCurso.dias.find(d => d.fecha===fecha);
    if (!dia) return;
    const bloque = dia[momento];
    const arr = perfil==='bebe' ? 'platosBebe' : 'platosMayores';
    if (!bloque[arr]) bloque[arr] = [];
    bloque[arr][fila] = { id: platoId, nombre: platoNombre };

    // Actualiza la celda en la tabla sin re-renderizar todo
    const celda = document.querySelector(
      `.menu-td-editable[data-fecha="${fecha}"][data-momento="${momento}"][data-perfil="${perfil}"][data-fila="${fila}"]`
    );
    if (celda) {
      celda.querySelector('.menu-td-nombre').textContent = platoNombre;
    }
  }

  // ── Bind de eventos del asistente ────────────────────────────────

  function _bindPasoEvents() {
    switch(_paso) {
      case 1: _bindPaso1(); break;
      case 2: _bindPaso2(); break;
      case 3: _bindPaso3(); break;
      case 5: _bindPaso5(); break;
    }
  }

  function _bindPaso1() {
    document.getElementById('menu-semanas-plus')?.addEventListener('click',()=>{
      _menuEnCurso.numSemanas = Math.min(8, _menuEnCurso.numSemanas+1);
      const el = document.getElementById('menu-semanas-val');
      if (el) el.textContent = _menuEnCurso.numSemanas;
    });
    document.getElementById('menu-semanas-minus')?.addEventListener('click',()=>{
      _menuEnCurso.numSemanas = Math.max(1, _menuEnCurso.numSemanas-1);
      const el = document.getElementById('menu-semanas-val');
      if (el) el.textContent = _menuEnCurso.numSemanas;
    });
    document.getElementById('menu-fecha-inicio')?.addEventListener('change',(e)=>{
      _menuEnCurso.fechaInicio = e.target.value;
      _menuEnCurso.fechaFin = Dates.addDays(e.target.value, _menuEnCurso.numSemanas*7-1);
    });
    document.getElementById('menu-paso1-next')?.addEventListener('click',()=>{
      const fechaEl = document.getElementById('menu-fecha-inicio');
      if (fechaEl) _menuEnCurso.fechaInicio = fechaEl.value;
      _menuEnCurso.fechaFin = Dates.addDays(_menuEnCurso.fechaInicio, _menuEnCurso.numSemanas*7-1);
      _paso=2; _renderAsistente();
    });
  }

  function _bindPaso2() {
    document.getElementById('menu-paso2-next')?.addEventListener('click',()=>{
      // Lee los días especiales seleccionados
      const selects = document.querySelectorAll('.menu-dia-esp-select');
      _menuEnCurso.dias = [];
      selects.forEach(sel => {
        if (sel.value) {
          _menuEnCurso.dias.push({ fecha: sel.dataset.fecha, tipoEspecial: sel.value });
        }
      });
      _paso=3; _renderAsistente();
    });
  }

  function _bindPaso3() {
    document.getElementById('menu-paso3-next')?.addEventListener('click',()=>{
      _paso=4; _renderAsistente();
    });
    document.getElementById('menu-paso3-skip')?.addEventListener('click',()=>{
      _paso=4; _renderAsistente();
    });
    document.querySelectorAll('.menu-toggle-forzar').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const id = btn.dataset.id;
        const state = App.getState();
        const inv = [...(state.inventario||[])];
        const idx = inv.findIndex(i=>i.id===id);
        if(idx===-1) return;
        inv[idx]={...inv[idx],forzarUso:!inv[idx].forzarUso};
        await App.setState('inventario',inv);
        btn.style.background = inv[idx].forzarUso?'var(--color-primary-light)':'';
        btn.style.color      = inv[idx].forzarUso?'var(--color-primary)':'';
        btn.textContent      = inv[idx].forzarUso?'⭐ Forzado':'⭐ Usar';
      });
    });
  }

  function _bindPaso5() {
    document.querySelectorAll('.menu-td-editable').forEach(td=>{
      td.addEventListener('click',()=>{
        _abrirPopupPlato(td.dataset.fecha, td.dataset.momento, td.dataset.perfil, parseInt(td.dataset.fila));
      });
    });
    document.getElementById('menu-btn-confirmar')?.addEventListener('click', _confirmarMenu);
  }

  // ── Utils ────────────────────────────────────────────────────────

  function _ensureView() {
    if (!document.getElementById('view-menu')) {
      const v=document.createElement('div');
      v.id='view-menu'; v.className='view';
      document.getElementById('app-content')?.appendChild(v);
    }
  }

  return { render };

})();
