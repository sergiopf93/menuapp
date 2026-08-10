/**
 * MenuApp — Módulo de Configuración (Fase 5 — completo)
 *
 * Secciones:
 * - Familia: gestión de personas (adultos y bebés)
 * - Supermercados: añadir, editar, reordenar secciones
 * - Días especiales: tipos configurables
 * - Generador: parámetros del motor de menús
 * - Notificaciones: activar/desactivar tipos
 * - Cuenta: info de usuario, cerrar sesión
 *
 * @module Configuracion
 */

const Configuracion = (() => {

  let _seccion = 'familia';

  const SECCIONES = [
    { id:'familia',        label:'👨‍👩‍👧 Familia'         },
    { id:'supermercados',  label:'🛒 Supermercados'    },
    { id:'dias-especiales',label:'📅 Días especiales'  },
    { id:'generador',      label:'⚙️ Generador'         },
    { id:'notificaciones', label:'🔔 Notificaciones'   },
    { id:'cuenta',         label:'👤 Cuenta'           },
  ];

  // ── API pública ──────────────────────────────────────────────────

  function render() {
    _ensureView();
    const view = document.getElementById('view-config');
    if (!view) return;
    view.innerHTML = _buildShell();
    _bindNavEvents();
    _renderSeccion();
  }

  // ── Shell ────────────────────────────────────────────────────────

  function _buildShell() {
    return `
      <h1 class="module-title" style="margin-bottom:var(--space-4)">Configuración</h1>
      <div class="cfg-nav" id="cfg-nav">
        ${SECCIONES.map(s=>`
          <button class="cfg-nav-btn ${_seccion===s.id?'active':''}" data-seccion="${s.id}">
            ${s.label}
          </button>`).join('')}
      </div>
      <div id="cfg-content" style="margin-top:var(--space-5)"></div>
    `;
  }

  function _bindNavEvents() {
    document.getElementById('cfg-nav')?.addEventListener('click', e=>{
      const btn = e.target.closest('.cfg-nav-btn');
      if (!btn) return;
      _seccion = btn.dataset.seccion;
      document.querySelectorAll('.cfg-nav-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      _renderSeccion();
    });
  }

  function _renderSeccion() {
    const container = document.getElementById('cfg-content');
    if (!container) return;
    switch(_seccion) {
      case 'familia':         container.innerHTML = _buildFamilia();         _bindFamiliaEvents();        break;
      case 'supermercados':   container.innerHTML = _buildSupermercados();   _bindSupermercadosEvents();  break;
      case 'dias-especiales': container.innerHTML = _buildDiasEspeciales();  _bindDiasEspEvents();        break;
      case 'generador':       container.innerHTML = _buildGenerador();       _bindGeneradorEvents();      break;
      case 'notificaciones':  container.innerHTML = _buildNotificaciones();  _bindNotifEvents();          break;
      case 'cuenta':          container.innerHTML = _buildCuenta();          _bindCuentaEvents();         break;
    }
  }

  // ── Sección: Familia ─────────────────────────────────────────────

  function _buildFamilia() {
    const config = App.getState().config || {};
    const personas = config.personas || [];
    return `
      <div class="cfg-section">
        <div class="cfg-section-header">
          <h2 class="cfg-section-title">Miembros de la familia</h2>
          <button class="btn btn-primary btn-sm" id="cfg-add-persona">+ Añadir</button>
        </div>
        <p class="text-sm text-muted" style="margin-bottom:var(--space-4)">
          Define quién forma la familia. El generador de menú usa esta información para crear platos de adultos y bebés por separado.
        </p>
        <div id="cfg-personas-lista">
          ${personas.length === 0
            ? '<p class="text-sm text-muted">No hay personas configuradas.</p>'
            : personas.map(p => `
                <div class="cfg-persona-card" data-id="${p.id}">
                  <div>
                    <span class="cfg-persona-nombre">${UI.escapeHtml(p.nombre)}</span>
                    <span class="badge ${p.tipo==='bebe'?'badge-blue':'badge-gray'}" style="margin-left:8px">
                      ${p.tipo==='bebe'?'👶 Bebé':'🧑 Adulto'}
                    </span>
                  </div>
                  <div style="display:flex;gap:var(--space-2)">
                    <button class="inv-action-btn inv-action-edit cfg-edit-persona" data-id="${p.id}">✏️</button>
                    <button class="inv-action-btn inv-action-delete cfg-del-persona" data-id="${p.id}">🗑</button>
                  </div>
                </div>`).join('')}
        </div>
      </div>`;
  }

  function _bindFamiliaEvents() {
    document.getElementById('cfg-add-persona')?.addEventListener('click', ()=>_formPersona(null));
    document.getElementById('cfg-personas-lista')?.addEventListener('click', async e=>{
      const id = e.target.closest('[data-id]')?.dataset.id;
      if (!id) return;
      if (e.target.closest('.cfg-edit-persona')) _formPersona(id);
      else if (e.target.closest('.cfg-del-persona')) await _deletePersona(id);
    });
  }

  function _formPersona(id) {
    const config = App.getState().config || {};
    const p = id ? (config.personas||[]).find(x=>x.id===id) : null;
    const container = document.createElement('div');
    container.innerHTML = `
      <div class="form-group">
        <label class="form-label">Nombre <span class="required">*</span></label>
        <input class="form-control" id="cfg-p-nombre" value="${UI.escapeHtml(p?.nombre||'')}" placeholder="Ej: Mamá, Papá, Bebé..."/>
      </div>
      <div class="form-group">
        <label class="form-label">Tipo</label>
        <div class="pl-chips pl-chips--form">
          <button type="button" class="pl-chip cfg-tipo-chip ${(p?.tipo||'adulto')==='adulto'?'active':''}" data-val="adulto">🧑 Adulto</button>
          <button type="button" class="pl-chip cfg-tipo-chip ${p?.tipo==='bebe'?'active':''}" data-val="bebe">👶 Bebé</button>
        </div>
      </div>`;
    container.querySelectorAll('.cfg-tipo-chip').forEach(btn=>{
      btn.addEventListener('click',()=>{
        container.querySelectorAll('.cfg-tipo-chip').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
    UI.showModal({
      title: p ? 'Editar persona' : 'Añadir persona',
      content: container,
      buttons:[
        {label:'Cancelar',type:'secondary'},
        {label:p?'Guardar':'Añadir',type:'primary',onClick:async()=>{
          const nombre = document.getElementById('cfg-p-nombre')?.value.trim();
          if (!nombre) { UI.showToast('El nombre es obligatorio','error'); return; }
          const tipo = container.querySelector('.cfg-tipo-chip.active')?.dataset.val || 'adulto';
          const config = App.getState().config || {};
          const personas = [...(config.personas||[])];
          if (p) {
            const idx = personas.findIndex(x=>x.id===id);
            if (idx!==-1) personas[idx]={...personas[idx],nombre,tipo};
          } else {
            personas.push({id:`persona-${Date.now()}`,nombre,tipo});
          }
          await _saveConfig({personas});
          UI.showToast(`${nombre} ${p?'actualizado':'añadido'}`,'success');
          _renderSeccion();
        }},
      ],
    });
  }

  async function _deletePersona(id) {
    const config = App.getState().config||{};
    const p = (config.personas||[]).find(x=>x.id===id);
    if (!p) return;
    const ok = await UI.confirm(`¿Eliminar a <strong>${UI.escapeHtml(p.nombre)}</strong>?`,'Eliminar');
    if (!ok) return;
    const personas = (config.personas||[]).filter(x=>x.id!==id);
    await _saveConfig({personas});
    _renderSeccion();
  }

  // ── Sección: Supermercados ───────────────────────────────────────

  function _buildSupermercados() {
    const config = App.getState().config||{};
    const supers = config.supermercados||[];
    return `
      <div class="cfg-section">
        <div class="cfg-section-header">
          <h2 class="cfg-section-title">Supermercados</h2>
          <button class="btn btn-primary btn-sm" id="cfg-add-super">+ Añadir</button>
        </div>
        <p class="text-sm text-muted" style="margin-bottom:var(--space-4)">
          El orden de las secciones determina el recorrido en el modo compra.
        </p>
        ${supers.map(s=>`
          <div class="cfg-super-card" data-id="${s.id}">
            <div class="cfg-super-header">
              <span class="cfg-super-nombre">🛒 ${UI.escapeHtml(s.nombre)}</span>
              <div style="display:flex;gap:var(--space-2)">
                <button class="btn btn-secondary btn-sm cfg-edit-super" data-id="${s.id}">Editar secciones</button>
                <button class="inv-action-btn inv-action-delete cfg-del-super" data-id="${s.id}">🗑</button>
              </div>
            </div>
            <div class="cfg-super-secciones">
              ${(s.secciones||[]).map((sec,i)=>`
                <span class="cfg-seccion-chip">${i+1}. ${UI.escapeHtml(typeof sec==='string'?sec:sec.nombre)}</span>
              `).join('')}
            </div>
          </div>`).join('')}
        ${supers.length===0?'<p class="text-sm text-muted">No hay supermercados configurados.</p>':''}
      </div>`;
  }

  function _bindSupermercadosEvents() {
    document.getElementById('cfg-add-super')?.addEventListener('click',()=>_formSuper(null));
    document.querySelectorAll('.cfg-edit-super').forEach(btn=>{
      btn.addEventListener('click',()=>_formSuper(btn.dataset.id));
    });
    document.querySelectorAll('.cfg-del-super').forEach(btn=>{
      btn.addEventListener('click',async()=>{
        const config = App.getState().config||{};
        const s = (config.supermercados||[]).find(x=>x.id===btn.dataset.id);
        if (!s) return;
        const ok = await UI.confirm(`¿Eliminar <strong>${UI.escapeHtml(s.nombre)}</strong>?`,'Eliminar');
        if (!ok) return;
        await _saveConfig({supermercados:(config.supermercados||[]).filter(x=>x.id!==btn.dataset.id)});
        _renderSeccion();
      });
    });
  }

  function _formSuper(id) {
    const config = App.getState().config||{};
    const s = id?(config.supermercados||[]).find(x=>x.id===id):null;
    const secciones = (s?.secciones||[]).map(x=>typeof x==='string'?x:x.nombre);

    const container = document.createElement('div');
    container.innerHTML = `
      <div class="form-group">
        <label class="form-label">Nombre <span class="required">*</span></label>
        <input class="form-control" id="cfg-s-nombre" value="${UI.escapeHtml(s?.nombre||'')}" placeholder="Ej: Mercadona Pozuelo"/>
      </div>
      <div class="form-group">
        <label class="form-label">Secciones en orden de recorrido</label>
        <p class="form-hint">Una sección por línea. El orden aquí es el orden de la lista de la compra.</p>
        <textarea class="form-control" id="cfg-s-secciones" rows="12"
          style="font-size:var(--font-size-sm);line-height:1.8"
        >${secciones.length?secciones.join('\n'):'Frutas y verduras\nPanadería\nCharcutería\nCarnicería\nPescadería\nLácteos\nHuevos\nCongelados\nEnvasados\nPasta, arroz y legumbres\nConservas\nAceites y condimentos\nBebidas\nDroguería\nOtros'}</textarea>
      </div>`;

    UI.showModal({
      title: s?`Editar — ${s.nombre}`:'Añadir supermercado',
      content: container,
      buttons:[
        {label:'Cancelar',type:'secondary'},
        {label:'Guardar',type:'primary',onClick:async()=>{
          const nombre = document.getElementById('cfg-s-nombre')?.value.trim();
          if (!nombre) { UI.showToast('El nombre es obligatorio','error'); return; }
          const secs = document.getElementById('cfg-s-secciones')?.value
            .split('\n').map(l=>l.trim()).filter(Boolean);
          const supers = [...(config.supermercados||[])];
          if (s) {
            const idx = supers.findIndex(x=>x.id===id);
            if (idx!==-1) supers[idx]={...supers[idx],nombre,secciones:secs};
          } else {
            supers.push({id:`super-${Date.now()}`,nombre,secciones:secs});
          }
          await _saveConfig({supermercados:supers});
          UI.showToast('Supermercado guardado','success');
          _renderSeccion();
        }},
      ],
    });
  }

  // ── Sección: Días especiales ─────────────────────────────────────

  function _buildDiasEspeciales() {
    const config = App.getState().config||{};
    const tipos = config.tiposDiaEspecial||[];
    return `
      <div class="cfg-section">
        <div class="cfg-section-header">
          <h2 class="cfg-section-title">Tipos de días especiales</h2>
          <button class="btn btn-primary btn-sm" id="cfg-add-esp">+ Añadir</button>
        </div>
        <p class="text-sm text-muted" style="margin-bottom:var(--space-4)">
          Define situaciones donde no se cocina: comida fuera, viaje, fiesta...
        </p>
        ${tipos.map(t=>`
          <div class="cfg-item-card" data-id="${t.id}">
            <div class="cfg-item-info">
              <span class="cfg-item-nombre">${UI.escapeHtml(t.nombre)}</span>
              <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">
                ${t.afectaComida?'<span class="badge badge-orange">Sin comida</span>':''}
                ${t.afectaCena?'<span class="badge badge-orange">Sin cena</span>':''}
                <span class="badge badge-gray">Afecta: ${t.afectaA==='todos'?'todos':t.afectaA==='mayores'?'adultos':'bebé'}</span>
              </div>
            </div>
            <div style="display:flex;gap:var(--space-2)">
              <button class="inv-action-btn inv-action-edit cfg-edit-esp" data-id="${t.id}">✏️</button>
              <button class="inv-action-btn inv-action-delete cfg-del-esp" data-id="${t.id}">🗑</button>
            </div>
          </div>`).join('')}
        ${tipos.length===0?'<p class="text-sm text-muted">No hay tipos configurados.</p>':''}
      </div>`;
  }

  function _bindDiasEspEvents() {
    document.getElementById('cfg-add-esp')?.addEventListener('click',()=>_formDiaEsp(null));
    document.querySelectorAll('.cfg-edit-esp').forEach(btn=>btn.addEventListener('click',()=>_formDiaEsp(btn.dataset.id)));
    document.querySelectorAll('.cfg-del-esp').forEach(btn=>{
      btn.addEventListener('click',async()=>{
        const config=App.getState().config||{};
        const t=(config.tiposDiaEspecial||[]).find(x=>x.id===btn.dataset.id);
        if(!t) return;
        const ok=await UI.confirm(`¿Eliminar tipo <strong>${UI.escapeHtml(t.nombre)}</strong>?`,'Eliminar');
        if(!ok) return;
        await _saveConfig({tiposDiaEspecial:(config.tiposDiaEspecial||[]).filter(x=>x.id!==btn.dataset.id)});
        _renderSeccion();
      });
    });
  }

  function _formDiaEsp(id) {
    const config=App.getState().config||{};
    const t=id?(config.tiposDiaEspecial||[]).find(x=>x.id===id):null;
    const container=document.createElement('div');
    container.innerHTML=`
      <div class="form-group">
        <label class="form-label">Nombre <span class="required">*</span></label>
        <input class="form-control" id="cfg-e-nombre" value="${UI.escapeHtml(t?.nombre||'')}" placeholder="Ej: Comida fuera, Viaje..."/>
      </div>
      <div class="form-group">
        <label class="form-label">Afecta a</label>
        <select class="form-control" id="cfg-e-afecta">
          <option value="todos"   ${(t?.afectaA||'todos')==='todos'?'selected':''}>Todos (adultos y bebé)</option>
          <option value="mayores" ${t?.afectaA==='mayores'?'selected':''}>Solo adultos</option>
          <option value="bebe"    ${t?.afectaA==='bebe'?'selected':''}>Solo bebé</option>
        </select>
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="cfg-e-comida" ${t?.afectaComida!==false?'checked':''}/>
          <span class="form-label" style="margin:0">Anula la comida del mediodía</span>
        </label>
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="cfg-e-cena" ${t?.afectaCena?'checked':''}/>
          <span class="form-label" style="margin:0">Anula la cena</span>
        </label>
      </div>`;
    UI.showModal({
      title:t?`Editar — ${t.nombre}`:'Nuevo tipo de día especial',
      content:container,
      buttons:[
        {label:'Cancelar',type:'secondary'},
        {label:'Guardar',type:'primary',onClick:async()=>{
          const nombre=document.getElementById('cfg-e-nombre')?.value.trim();
          if(!nombre){UI.showToast('El nombre es obligatorio','error');return;}
          const nuevo={
            id:t?.id||`esp-${Date.now()}`,
            nombre,
            afectaA:document.getElementById('cfg-e-afecta')?.value||'todos',
            afectaComida:document.getElementById('cfg-e-comida')?.checked||false,
            afectaCena:document.getElementById('cfg-e-cena')?.checked||false,
            generaMayores:false,
            generaBebe:false,
          };
          const tipos=[...(config.tiposDiaEspecial||[])];
          const idx=tipos.findIndex(x=>x.id===nuevo.id);
          if(idx!==-1) tipos[idx]=nuevo; else tipos.push(nuevo);
          await _saveConfig({tiposDiaEspecial:tipos});
          UI.showToast('Guardado','success');
          _renderSeccion();
        }},
      ],
    });
  }

  // ── Sección: Generador ───────────────────────────────────────────

  function _buildGenerador() {
    const config=App.getState().config||{};
    const cfg=config.configuracionMenus||{};
    return `
      <div class="cfg-section">
        <h2 class="cfg-section-title">Parámetros del generador</h2>
        <div class="form-group" style="margin-top:var(--space-4)">
          <label class="form-label" for="cfg-g-freq">Semanas mínimas entre repeticiones (por defecto)</label>
          <input class="form-control" id="cfg-g-freq" type="number" min="1" max="8"
                 value="${cfg.frecuenciaMinSemanasPorDefecto||2}"/>
          <p class="form-hint">Cada plato puede sobreescribir este valor individualmente.</p>
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="cfg-g-proteinas" ${cfg.equilibrioProteinas!==false?'checked':''}/>
            <span class="form-label" style="margin:0">Equilibrio de proteínas</span>
          </label>
          <p class="form-hint">Evita más de 2 días seguidos con el mismo tipo de proteína (carne, pescado, legumbre...).</p>
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="cfg-g-comidacena" ${cfg.equilibrioComidaCena!==false?'checked':''}/>
            <span class="form-label" style="margin:0">Platos pesados solo a mediodía</span>
          </label>
          <p class="form-hint">Legumbres, guisos y platos contundentes se reservan para la comida del mediodía.</p>
        </div>
        <button class="btn btn-primary" id="cfg-g-guardar">Guardar cambios</button>
      </div>`;
  }

  function _bindGeneradorEvents() {
    document.getElementById('cfg-g-guardar')?.addEventListener('click',async()=>{
      const freq=parseInt(document.getElementById('cfg-g-freq')?.value)||2;
      const prot=document.getElementById('cfg-g-proteinas')?.checked!==false;
      const cc=document.getElementById('cfg-g-comidacena')?.checked!==false;
      await _saveConfig({configuracionMenus:{
        frecuenciaMinSemanasPorDefecto:freq,
        equilibrioProteinas:prot,
        equilibrioComidaCena:cc,
      }});
      UI.showToast('Configuración del generador guardada','success');
    });
  }

  // ── Sección: Notificaciones ──────────────────────────────────────

  function _buildNotificaciones() {
    const config=App.getState().config||{};
    const notif=config.notificaciones||{};
    const pendientes=notif.pendientes||[];
    const hoy=Dates.today();

    const proximas=pendientes.filter(n=>{
      const d=new Date(n.scheduledAt);
      return d>=new Date() && Dates.daysUntil(Dates.toISO(d))<=7;
    }).slice(0,5);

    return `
      <div class="cfg-section">
        <h2 class="cfg-section-title">Notificaciones</h2>
        <div class="form-group" style="margin-top:var(--space-4)">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="cfg-n-activas" ${notif.activadas!==false?'checked':''}/>
            <span class="form-label" style="margin:0">Notificaciones activadas</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-label" for="cfg-n-congelador">Horas de antelación para sacar del congelador</label>
          <input class="form-control" id="cfg-n-congelador" type="number"
                 min="1" max="72" value="${notif.horasAntelacionCongelador||24}"/>
        </div>
        <div class="form-group">
          <label class="form-label" for="cfg-n-caducidad">Días de alerta de caducidad</label>
          <input class="form-control" id="cfg-n-caducidad" type="number"
                 min="1" max="30" value="${notif.diasAlertaCaducidad||7}"/>
        </div>
        <button class="btn btn-primary" id="cfg-n-guardar">Guardar</button>

        ${proximas.length>0?`
          <div style="margin-top:var(--space-6)">
            <h3 class="section-title">Próximas notificaciones</h3>
            ${proximas.map(n=>`
              <div class="cfg-item-card">
                <div class="cfg-item-info">
                  <span class="cfg-item-nombre">${UI.escapeHtml(n.title)}</span>
                  <span class="text-xs text-muted">${UI.escapeHtml(n.body)}</span>
                  <span class="text-xs text-muted">${new Date(n.scheduledAt).toLocaleString('es-ES',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
                </div>
              </div>`).join('')}
          </div>`:
          `<p class="text-sm text-muted" style="margin-top:var(--space-4)">No hay notificaciones programadas próximamente.</p>`}

        <div style="margin-top:var(--space-5)">
          <button class="btn btn-secondary btn-full" id="cfg-n-permiso">
            🔔 Solicitar permiso de notificaciones
          </button>
          <p class="form-hint" style="margin-top:var(--space-2)">Necesario para recibir avisos en este dispositivo.</p>
        </div>
      </div>`;
  }

  function _bindNotifEvents() {
    document.getElementById('cfg-n-guardar')?.addEventListener('click',async()=>{
      const config=App.getState().config||{};
      const notif={...(config.notificaciones||{})};
      notif.activadas=document.getElementById('cfg-n-activas')?.checked!==false;
      notif.horasAntelacionCongelador=parseInt(document.getElementById('cfg-n-congelador')?.value)||24;
      notif.diasAlertaCaducidad=parseInt(document.getElementById('cfg-n-caducidad')?.value)||7;
      await _saveConfig({notificaciones:notif});
      UI.showToast('Notificaciones guardadas','success');
    });

    document.getElementById('cfg-n-permiso')?.addEventListener('click',async()=>{
      if(!('Notification' in window)){
        UI.showToast('Tu navegador no soporta notificaciones','error'); return;
      }
      const perm=await Notification.requestPermission();
      if(perm==='granted'){
        UI.showToast('✓ Notificaciones activadas en este dispositivo','success');
        new Notification('MenuApp',{body:'Las notificaciones funcionan correctamente.',icon:'/assets/icons/icon-192.png'});
      } else {
        UI.showToast('Permiso denegado. Actívalo en los ajustes del navegador.','error');
      }
    });
  }

  // ── Sección: Cuenta ──────────────────────────────────────────────

  function _buildCuenta() {
    const user=Auth.getUserInfo();
    const {rootFolderId}=Drive.getFolderIds();
    return `
      <div class="cfg-section">
        <h2 class="cfg-section-title">Mi cuenta</h2>
        ${user?`
          <div class="cfg-cuenta-card">
            <div>
              <p class="cfg-item-nombre">${UI.escapeHtml(user.name)}</p>
              <p class="text-sm text-muted">${UI.escapeHtml(user.email)}</p>
            </div>
          </div>`:''}
        <div class="form-group" style="margin-top:var(--space-4)">
          <p class="text-sm text-muted">
            📁 Carpeta de datos en Google Drive:
            <a href="https://drive.google.com/drive/folders/${rootFolderId||''}"
               target="_blank" class="btn-text" style="display:inline">
              Abrir en Drive ↗
            </a>
          </p>
        </div>
        <div style="display:flex;flex-direction:column;gap:var(--space-3);margin-top:var(--space-5)">
          <button class="btn btn-secondary btn-full" id="cfg-btn-sync">
            🔄 Sincronizar ahora
          </button>
          <button class="btn btn-danger btn-full" id="cfg-btn-logout">
            Cerrar sesión
          </button>
        </div>
        <div style="margin-top:var(--space-6);padding-top:var(--space-4);border-top:1px solid var(--color-border)">
          <p class="text-xs text-muted">MenuApp v1.0 · Datos almacenados en tu Google Drive personal.</p>
        </div>
      </div>`;
  }

  function _bindCuentaEvents() {
    document.getElementById('cfg-btn-sync')?.addEventListener('click',async()=>{
      await Sync.syncNow();
    });
    document.getElementById('cfg-btn-logout')?.addEventListener('click',async()=>{
      const ok=await UI.confirm('¿Cerrar sesión? Los datos permanecen en Google Drive.','Cerrar sesión');
      if(!ok) return;
      await Auth.logout();
      await Storage.clear();
      location.reload();
    });
  }

  // ── Guardar configuración ────────────────────────────────────────

  async function _saveConfig(partial) {
    const state=App.getState();
    const config={...(state.config||{}), ...partial, actualizadoEn:new Date().toISOString()};
    await App.setState('config',config);
  }

  // ── Utils ────────────────────────────────────────────────────────

  function _ensureView() {
    if(!document.getElementById('view-config')){
      const v=document.createElement('div');
      v.id='view-config';v.className='view';
      document.getElementById('app-content')?.appendChild(v);
    }
  }

  return { render };

})();
