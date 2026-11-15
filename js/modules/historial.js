/**
 * MenuApp — Módulo de Historial de Menús (Fase 5)
 *
 * Muestra todos los menús guardados en Drive ordenados por fecha.
 * Permite ver el detalle de cada semana.
 *
 * @module Historial
 */

const Historial = (() => {

  let _menus = [];
  let _cargando = false;
  let _erroresCarga = 0;

  function render() {
    _ensureView();
    const view = document.getElementById('view-historial');
    if (!view) return;
    view.innerHTML = `
      <div class="module-header">
        <h1 class="module-title">Historial</h1>
        <button class="btn btn-secondary btn-sm" id="hist-analizar" disabled>Analizar hábitos</button>
      </div>
      <div id="hist-content">
        <div class="loading-container" style="padding:var(--space-12) 0">
          <div class="loading-spinner"></div>
          <p class="loading-message">Cargando historial...</p>
        </div>
      </div>`;
    document.getElementById('hist-analizar')?.addEventListener('click', _mostrarAnalisis);
    _cargar();
  }

  async function _cargar() {
    if (_cargando) return;
    _cargando = true;
    try {
      const archivos = await Drive.listMenuFiles();
      _menus = [];
      _erroresCarga = 0;
      for (const f of archivos) {
        try {
          const m = await Drive.readMenuJson(f.id);
          if (m) _menus.push({ ...m, _fileId: f.id, _fileName: f.name });
        } catch { _erroresCarga++; }
      }
      const hoy = Dates.today();
      const grupo = m => m.fechaInicio <= hoy && m.fechaFin >= hoy ? 0 : m.fechaFin < hoy ? 1 : 2;
      _menus.sort((a, b) => grupo(a) - grupo(b) || (grupo(a) === 2
        ? String(a.fechaInicio || '').localeCompare(String(b.fechaInicio || ''))
        : String(b.fechaInicio || '').localeCompare(String(a.fechaInicio || ''))));
      _renderLista();
    } catch (err) {
      document.getElementById('hist-content').innerHTML =
        `<p class="text-sm text-muted">Error cargando historial: ${UI.escapeHtml(err.message)}</p>`;
    } finally {
      _cargando = false;
    }
  }

  function _renderLista() {
    const container = document.getElementById('hist-content');
    if (!container) return;
    const analizar = document.getElementById('hist-analizar');
    if (analizar) analizar.disabled = _menus.length === 0;

    if (_menus.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <h2 class="empty-state-title">Sin historial</h2>
          <p class="empty-state-desc">Los menús confirmados aparecerán aquí.</p>
        </div>`;
      return;
    }

    container.innerHTML = _menus.map((m, index) => {
      const estaActivo = m.fechaInicio <= Dates.today() && m.fechaFin >= Dates.today();
      const numPlatos = _contarPlatos(m);
      return `
        <button type="button" class="cfg-item-card hist-menu-card" data-index="${index}" style="cursor:pointer;width:100%;text-align:left">
          <div class="cfg-item-info">
            <div style="display:flex;align-items:center;gap:var(--space-2)">
              <span class="cfg-item-nombre">
                Semana del ${Dates.format(m.fechaInicio,'short')} al ${Dates.format(m.fechaFin,'short')}
              </span>
              ${estaActivo ? '<span class="badge badge-green">Activa</span>' : ''}
              ${m.estado==='borrador' ? '<span class="badge badge-orange">Borrador</span>' : ''}
            </div>
            <span class="text-xs text-muted">${numPlatos} platos · Generado ${_formatFechaRelativa(m.generadoEn)}</span>
          </div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" style="flex-shrink:0;color:var(--color-text-muted)">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>`;
    }).join('');

    container.querySelectorAll('.hist-menu-card').forEach(card => {
      card.addEventListener('click', () => {
        const menu = _menus[Number(card.dataset.index)];
        if (menu) _mostrarDetalle(menu);
      });
    });
  }

  function _mostrarDetalle(menu) {
    const config = App.getState().config || {};
    const tieneBebe = (config.personas || []).some(p => p.tipo === 'bebe');

    // Reutiliza la función de tabla del módulo de Menú
    const tablaHtml = _buildTablaHistorial(menu, tieneBebe);

    const container = document.createElement('div');
    container.innerHTML = tablaHtml;

    const modal = UI.showModal({
      title: `Menú del ${Dates.format(menu.fechaInicio,'long')}`,
      content: container,
      buttons: [{ label: 'Editar menú', type: 'primary', onClick: () => {
        modal.close();
        Menu.editar(menu, 'historial');
      } }],
    });
  }

  function _buildTablaHistorial(menu, tieneBebe) {
    const dias = menu.dias || [];
    const bloques = [
      { momento:'comida', perfil:'mayores', label:'🍽 Comida · Adultos' },
      ...(tieneBebe ? [{ momento:'comida', perfil:'bebe', label:'👶 Comida · Bebé' }] : []),
      { momento:'cena', perfil:'mayores', label:'🌙 Cena · Adultos' },
      ...(tieneBebe ? [{ momento:'cena', perfil:'bebe', label:'👶 Cena · Bebé' }] : []),
    ];

    return `
      <div style="overflow-x:auto">
        <table class="menu-tabla" style="min-width:400px">
          <thead>
            <tr>
              <th class="menu-th-momento"></th>
              ${dias.map(d=>`
                <th class="menu-th-dia">
                  <span class="menu-th-nombre">${d.diaSemana.substring(0,3)}</span>
                  <span class="menu-th-num">${Dates.fromISO(d.fecha).getDate()}</span>
                </th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${bloques.map(b => {
              let html = `<tr class="menu-tr-label"><td colspan="${dias.length+1}">${b.label}</td></tr>`;
              html += `<tr>`;
              html += `<td class="menu-td-rowlabel"></td>`;
              dias.forEach(d => {
                const bloque = d[b.momento];
                if (!bloque?.activo) { html+=`<td class="menu-td menu-td-especial">—</td>`; return; }
                const platos = b.perfil==='bebe' ? bloque?.platosBebe : bloque?.platosMayores;
                const nombres = (platos||[]).map(p=>UI.escapeHtml(p.nombre)).join(' + ');
                html += `<td class="menu-td">${nombres||'–'}</td>`;
              });
              html += `</tr>`;
              return html;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function _contarPlatos(menu) {
    const ids = new Set();
    (menu.dias||[]).forEach(d=>{
      ['comida','cena'].forEach(m=>{
        [...(d[m]?.platosMayores||[]),...(d[m]?.platosBebe||[])].forEach(p=>ids.add(p.id));
      });
    });
    return ids.size;
  }

  function _formatFechaRelativa(isoString) {
    if (!isoString) return '';
    const dias = -Dates.daysUntil(isoString.substring(0,10));
    if (dias === 0) return 'hoy';
    if (dias === 1) return 'ayer';
    if (dias < 7)  return `hace ${dias} días`;
    return Dates.format(isoString.substring(0,10));
  }

  function _ensureView() {
    if (!document.getElementById('view-historial')) {
      const v=document.createElement('div');
      v.id='view-historial';v.className='view';
      document.getElementById('app-content')?.appendChild(v);
    }
  }

  /** Describe menús planificados; no infiere comidas consumidas ni necesidades nutricionales. */
  function analizarMenus(menus, catalogo, hoy = Dates.today()) {
    const porFecha = new Map();
    let borradoresExcluidos = 0;
    let diasNoHistoricosExcluidos = 0;
    let solapesResueltos = 0;
    for (const menu of menus) {
      if (menu.estado === 'borrador') { borradoresExcluidos++; continue; }
      const version = menu.confirmadoEn || menu.generadoEn || '';
      for (const dia of menu.dias || []) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dia.fecha || '') ||
            !Number.isFinite(Date.parse(`${dia.fecha}T00:00:00Z`)) ||
            new Date(`${dia.fecha}T00:00:00Z`).toISOString().slice(0, 10) !== dia.fecha) continue;
        if (dia.fecha >= hoy) { diasNoHistoricosExcluidos++; continue; }
        const previo = porFecha.get(dia.fecha);
        if (previo) solapesResueltos++;
        if (!previo || version > previo.version) {
          porFecha.set(dia.fecha, { dia, version });
        }
      }
    }

    const fechas = [...porFecha.keys()].sort();
    const semanas = new Map();
    for (const fecha of fechas) {
      const lunes = Dates.startOfWeek(fecha);
      if (!semanas.has(lunes)) semanas.set(lunes, { inicio: lunes, fin: Dates.addDays(lunes, 6), fechas: [] });
      semanas.get(lunes).fechas.push(fecha);
    }
    const cobertura = [...semanas.values()].map(semana => ({ ...semana, completa: semana.fechas.length === 7 }));
    const completas = new Set(cobertura.filter(semana => semana.completa).map(semana => semana.inicio));
    const porId = new Map(catalogo.filter(plato => plato.id).map(plato => [plato.id, plato]));
    const porNombre = new Map(catalogo.map(plato => [Sync.normalize(plato.nombre), plato]));
    const platos = new Map();
    const diasSemana = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
      .map(dia => ({ dia, adultos: { comida: 0, cena: 0 }, bebe: { comida: 0, cena: 0 } }));

    for (const fecha of fechas) {
      const dia = porFecha.get(fecha).dia;
      const lunes = Dates.startOfWeek(fecha);
      const indiceDia = (Dates.fromISO(fecha).getDay() + 6) % 7;
      for (const momento of ['comida', 'cena']) {
        const bloque = dia[momento];
        if (!bloque?.activo) continue;
        for (const [perfil, campo, activo] of [
          ['adultos', 'platosMayores', '_mayActivo'], ['bebe', 'platosBebe', '_bebeActivo'],
        ]) {
          if (bloque[activo] === false) continue;
          const vistos = new Set();
          for (const ref of bloque[campo] || []) {
            const nombre = Sync.normalize(ref.nombre);
            if (!ref.id && !nombre) continue;
            const existente = porId.get(ref.id) || porNombre.get(nombre);
            const clavePlato = existente?.id || ref.id || nombre;
            const clave = `${perfil}:${clavePlato}`;
            if (vistos.has(clave)) continue;
            vistos.add(clave);
            if (!platos.has(clave)) platos.set(clave, {
              id: existente?.id || ref.id || null,
              nombre: existente?.nombre || ref.nombre || ref.id,
              perfil, existeEnCatalogo: !!existente,
              frecuenciaMinSemanas: Number(existente?.frecuenciaMinSemanas) > 0 ? Number(existente.frecuenciaMinSemanas) : null,
              comida: 0, cena: 0, total: 0, aparicionesSemanasCompletas: 0, aparicionesSemanasParciales: 0,
              semanas: new Set(),
            });
            const plato = platos.get(clave);
            plato[momento]++;
            plato.total++;
            plato[completas.has(lunes) ? 'aparicionesSemanasCompletas' : 'aparicionesSemanasParciales']++;
            plato.semanas.add(lunes);
            diasSemana[indiceDia][perfil][momento]++;
          }
        }
      }
    }

    const filas = [...platos.values()].map(plato => {
      const semanasConPlato = [...plato.semanas].sort();
      const intervalos = semanasConPlato.slice(1).map((semana, index) =>
        (Date.parse(`${semana}T00:00:00Z`) - Date.parse(`${semanasConPlato[index]}T00:00:00Z`)) / 604800000);
      return {
        ...plato, semanas: semanasConPlato,
        promedioPorSemanaCompleta: completas.size ? plato.aparicionesSemanasCompletas / completas.size : null,
        intervalosSemanas: intervalos,
        intervaloMedioSemanas: intervalos.length ? intervalos.reduce((sum, intervalo) => sum + intervalo, 0) / intervalos.length : null,
      };
    }).sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre) || a.perfil.localeCompare(b.perfil));

    return {
      version: 1, tipo: 'planificacion_historica', fechaCorteExclusiva: hoy,
      descripcion: 'Apariciones en menús planificados. No representan consumo confirmado ni una evaluación nutricional.',
      periodo: { desde: fechas[0] || null, hasta: fechas.at(-1) || null },
      cobertura: { dias: fechas.length, semanasCompletas: completas.size, semanasParciales: cobertura.length - completas.size, semanas: cobertura },
      exclusiones: { borradores: borradoresExcluidos, diasHoyOFuturos: diasNoHistoricosExcluidos, solapesResueltos },
      diasSemana, platos: filas,
      platosAusentesCatalogo: filas.filter(plato => !plato.existeEnCatalogo).map(({ id, nombre, perfil, total }) => ({ id, nombre, perfil, total })),
    };
  }

  function _mostrarAnalisis() {
    const datosFuente = JSON.parse(JSON.stringify({
      menus: _menus, catalogo: App.getState().platos || [], menusNoDescargados: _erroresCarga,
    }));
    const informe = analizarMenus(datosFuente.menus, datosFuente.catalogo);
    const numero = valor => valor === null ? 'Sin datos suficientes' : valor.toLocaleString('es-ES', { maximumFractionDigits: 2 });
    const tabla = (etiqueta, encabezados, filas) => `
      <div role="region" aria-label="${etiqueta}" tabindex="0" style="overflow-x:auto;margin:var(--space-3) 0">
        <table class="menu-tabla hist-analisis-tabla" style="min-width:620px">
          <caption class="text-sm" style="text-align:left;padding:var(--space-2)">${etiqueta}</caption>
          <thead><tr>${encabezados.map(texto => `<th scope="col">${texto}</th>`).join('')}</tr></thead>
          <tbody>${filas.join('')}</tbody>
        </table>
      </div>`;
    const fila = celdas => `<tr>${celdas.map((celda, index) => index === 0
      ? `<th scope="row">${celda}</th>` : `<td>${celda}</td>`).join('')}</tr>`;
    const cobertura = informe.cobertura;
    const contenido = `
      <p class="text-sm"><strong>Planificación histórica, no consumo confirmado.</strong> Se cuentan apariciones de platos; no raciones ni personas. Se excluyen borradores, hoy y fechas futuras.</p>
      ${_erroresCarga ? `<p class="text-sm">No se pudieron descargar ${_erroresCarga} menús. El informe solo incluye los disponibles.</p>` : ''}
      <p class="text-sm mt-3">${cobertura.dias} días · ${cobertura.semanasCompletas} semanas completas de lunes a domingo · ${cobertura.semanasParciales} parciales.</p>
      ${informe.periodo.desde ? `<p class="text-sm text-muted">Del ${Dates.format(informe.periodo.desde, 'numeric')} al ${Dates.format(informe.periodo.hasta, 'numeric')}. Los días solapados usan el menú confirmado o generado más reciente.</p>` : '<p class="text-sm mt-3">No hay fechas anteriores a hoy para analizar.</p>'}
      ${tabla('Apariciones por día de la semana', ['Día', 'Adultos · comida', 'Adultos · cena', 'Bebé · comida', 'Bebé · cena'],
        informe.diasSemana.map(dia => fila([dia.dia, dia.adultos.comida, dia.adultos.cena, dia.bebe.comida, dia.bebe.cena])))}
      <p class="text-sm">La media usa solo semanas con los siete días presentes. Las apariciones en semanas parciales se muestran aparte. El intervalo observado mide la distancia media entre semanas distintas con ese plato, incluidas las parciales; con una sola semana no se puede calcular.</p>
      ${tabla('Platos y frecuencia planificada', ['Plato', 'Perfil', 'Comida', 'Cena', 'Media por semana completa', 'Apariciones parciales', 'Mínimo configurado (sem.)', 'Intervalo observado (sem.)'],
        informe.platos.map(plato => fila([
          UI.escapeHtml(plato.nombre), plato.perfil === 'bebe' ? 'Bebé' : 'Adultos', plato.comida, plato.cena,
          numero(plato.promedioPorSemanaCompleta), plato.aparicionesSemanasParciales,
          plato.existeEnCatalogo ? (plato.frecuenciaMinSemanas === null ? 'Sin configurar' : numero(plato.frecuenciaMinSemanas)) : 'Fuera del catálogo',
          numero(plato.intervaloMedioSemanas),
        ])))}
      <h3 class="section-title">Platos usados que faltan en el catálogo</h3>
      ${informe.platosAusentesCatalogo.length ? `<ul>${informe.platosAusentesCatalogo.map(plato => `<li>${UI.escapeHtml(plato.nombre)} · ${plato.perfil === 'bebe' ? 'Bebé' : 'Adultos'} (${plato.total})</li>`).join('')}</ul>` : '<p class="text-sm">Todos los platos identificados aparecen en el catálogo actual.</p>'}
      ${cobertura.semanasParciales ? `<details class="mt-3"><summary>Semanas parciales incluidas</summary><ul>${cobertura.semanas.filter(semana => !semana.completa).map(semana => `<li>${Dates.format(semana.inicio, 'numeric')}: ${semana.fechas.length}/7 días</li>`).join('')}</ul></details>` : ''}
      <p class="text-sm text-muted mt-3">Informe descriptivo de los menús descargados. No cambia el catálogo ni las frecuencias del generador.</p>`;
    UI.showModal({
      title: 'Análisis de hábitos planificados', content: contenido,
      buttons: [
        { label: 'Exportar JSON', type: 'secondary', onClick: () => _exportarAnalisis(informe, datosFuente) },
        { label: 'Cerrar', type: 'primary' },
      ],
    });
  }

  function _exportarAnalisis(informe, datosFuente) {
    const blob = new Blob([JSON.stringify({ informe, datosFuente }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `menuapp-planificacion-${informe.fechaCorteExclusiva}.json`;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { render, analizarMenus };

})();
