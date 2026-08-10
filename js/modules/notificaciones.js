/**
 * MenuApp — Módulo de Notificaciones (Fase 5)
 *
 * Tipos de notificaciones:
 * - Sacar del congelador (24h antes del plato)
 * - Preparar masa/remojo (horas configurables por plato)
 * - Artículo próximo a caducar
 * - Artículo caducado
 * - Compra pendiente (menú confirmado sin lista cerrada)
 *
 * @module Notificaciones
 */

const Notificaciones = (() => {

  /**
   * Inicializa el sistema de notificaciones.
   * Llamado desde App.boot() tras autenticación.
   */
  function init() {
    // Comprueba notificaciones pendientes cada vez que la app se abre
    _checkCaducidades();
    _checkComprasPendientes();

    // Envía las notificaciones programadas al Service Worker
    _syncConServiceWorker();

    // Programa una comprobación diaria
    const ahora = new Date();
    const manana8h = new Date(ahora);
    manana8h.setDate(manana8h.getDate() + 1);
    manana8h.setHours(8, 0, 0, 0);
    const msHasta8h = manana8h - ahora;
    setTimeout(() => {
      _checkCaducidades();
      _syncConServiceWorker();
      setInterval(() => {
        _checkCaducidades();
        _syncConServiceWorker();
      }, 24 * 60 * 60 * 1000);
    }, msHasta8h);
  }

  /**
   * Genera y devuelve las notificaciones para un menú dado.
   * Llamado al confirmar el menú.
   * @param {object} menu
   * @returns {Array}
   */
  function generarParaMenu(menu) {
    const state  = App.getState();
    const platos = state.platos || [];
    const config = state.config || {};
    const notif  = config.notificaciones || {};
    const notifs = [];

    if (notif.activadas === false) return notifs;

    (menu.dias || []).forEach(dia => {
      ['comida', 'cena'].forEach(momento => {
        const bloque = dia[momento];
        if (!bloque?.activo) return;

        const hora = momento === 'comida' ? '14:00' : '21:00';
        const todosPlatos = [
          ...(bloque.platosMayores || []),
          ...(bloque.platosBebe    || []),
        ];
        const idsUnicos = [...new Set(todosPlatos.map(p => p.id))];

        idsUnicos.forEach(pid => {
          const plato = platos.find(p => p.id === pid);
          if (!plato?.notificacionPrevia) return;

          const fechaPlato = new Date(`${dia.fecha}T${hora}`);
          const horas = plato.horasNotificacionPrevia || 16;
          const scheduledAt = new Date(fechaPlato.getTime() - horas * 60 * 60 * 1000);

          if (scheduledAt > new Date()) {
            notifs.push({
              id:          `notif-${plato.id}-${dia.fecha}-${momento}`,
              title:       `Recuerda: ${plato.nombre}`,
              body:        plato.notificacionPrevia,
              scheduledAt: scheduledAt.toISOString(),
              tipo:        'preparacion',
            });
          }
        });
      });
    });

    return notifs;
  }

  // ── Privados ─────────────────────────────────────────────────────

  function _checkCaducidades() {
    const state   = App.getState();
    const config  = state.config || {};
    const notif   = config.notificaciones || {};
    if (notif.activadas === false) return;

    const diasAlerta = notif.diasAlertaCaducidad || 7;
    const inventario = state.inventario || [];

    inventario.forEach(item => {
      const status = Dates.expiryStatus(item.fechaCaducidad);
      if (status === 'expired') {
        _mostrarNotifLocal(
          `${item.nombre} ha caducado`,
          `Revisa la ${item.ubicacion} y retíralo si es necesario.`
        );
      } else if (status === 'urgent' || status === 'soon') {
        const dias = Dates.daysUntil(item.fechaCaducidad);
        if (dias <= diasAlerta) {
          _mostrarNotifLocal(
            `${item.nombre} caduca en ${dias} día${dias !== 1 ? 's' : ''}`,
            `Está en ${item.ubicacion}. Úsalo pronto.`
          );
        }
      }
    });
  }

  function _checkComprasPendientes() {
    const state = App.getState();
    const menu  = state.menuActual;
    if (!menu || menu.estado !== 'confirmado') return;

    const compra = state.compraActual;
    if (compra && compra.estado !== 'completada') return;

    // Si el menú fue confirmado hace más de 24h y no hay compra cerrada
    if (menu.confirmadoEn) {
      const haceHoras = (Date.now() - new Date(menu.confirmadoEn)) / (1000 * 60 * 60);
      if (haceHoras > 24) {
        _mostrarNotifLocal(
          'Lista de la compra pendiente',
          'Tienes un menú confirmado pero la compra aún no se ha completado.'
        );
      }
    }
  }

  function _mostrarNotifLocal(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    new Notification(title, {
      body,
      icon: '/assets/icons/icon-192.png',
      badge:'/assets/icons/icon-192.png',
    });
  }

  function _syncConServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const state  = App.getState();
    const config = state.config || {};
    const pendientes = config.notificaciones?.pendientes || [];

    navigator.serviceWorker.ready.then(reg => {
      reg.active?.postMessage({
        type: 'CHECK_NOTIFICATIONS',
        notifications: pendientes,
      });
    }).catch(() => {});
  }

  return { init, generarParaMenu };

})();
