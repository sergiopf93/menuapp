# Contexto de MenuApp

Revisión del 13/11/2026. Base: `main`, commit `02f1b579640c8e0099c56f8582ffe03f4093a9e3` contrastado con GitHub antes de empezar. Rama: `fix/revision-audio-2026-11-13`.

## Funcionalidad y módulos

Aplicación familiar para planificar comidas y cenas de adultos/bebé, mantener platos e ingredientes, consultar inventario y gestionar una lista de compra compartida entre dispositivos.

| Zona | Archivos y responsabilidades |
| --- | --- |
| Arranque/estado | `js/app.js`: carga local, estado en memoria, navegación, dashboard y conexión posterior con Drive. |
| Google | `js/auth.js`: GIS OAuth en navegador, sesión/perfil en IndexedDB; `js/drive.js`: REST de Drive, carpetas, JSON y paginación. |
| Persistencia | `js/utils/storage.js`: IndexedDB `menuapp_db/kv_store`, claves `cache_*.json`. |
| Sincronización | `js/sync.js`: cola en `menuapp_sync_pendientes`, snapshots, escrituras serializadas por archivo, reintentos y polling. |
| Menú | `js/modules/menu.js`: calendario, asistente, generación, edición y confirmación. |
| Compra | `js/modules/compra.js`: lista/revisión, supermercado y checklist; copia local en `menuapp_compra_actual`, publicación explícita. |
| Catálogos | Artículos = productos comprables; platos = recetas con ingredientes, perfiles, momentos y criterios de generación. |
| Despensa | `inventario.js`: stock y prioridad de uso del generador; la lista de compra actual no descuenta inventario ni lo actualiza al cerrar. |
| Historial | `historial.js`: menús guardados e informe descriptivo exportable de planificación anterior a hoy. |
| Configuración | Personas, supermercados/secciones, días especiales, generador, avisos y cuenta. |
| PWA | `service-worker.js`, `manifest.json`, iconos y estilos. Caché de recursos propios; no cachea API de Drive ni SDK de Google. |

Los módulos son IIFE con objetos públicos compartidos, cargados mediante scripts clásicos en orden desde `index.html`. No hay bundler, backend propio, TypeScript ni dependencias de ejecución instaladas. El despliegue existente es GitHub Pages; la revisión no cambia su configuración ni despliega.

## Datos y comportamiento a preservar

Carpeta Drive `MenuApp`: `catalogo.json`, `inventario.json`, `platos.json`, `config.json`, `lista_compra.json` y subcarpetas `menus`, `compras` históricas y `backups`.

Los menús contienen fechas de inicio/fin, estado y días con bloques `comida`/`cena`, `platosMayores` y `platosBebe`. Los días especiales pueden desactivar cada perfil por separado. Las fechas de calendario se manejan como `YYYY-MM-DD` y las semanas comienzan en lunes.

La compra combina por nombre normalizado. Cada artículo puede llevar `actualizadoEn`; `removidos` conserva fecha por nombre para descartar versiones antiguas. Guardar/cerrar publica y puede quedar pendiente offline. Abrir o editar la lista no implica subirla. La compatibilidad con listas antiguas fechadas se conserva.

El generador respeta los criterios configurados del catálogo. Los contadores semanales reinician el lunes, manteniendo continuidad de sobras y prohibición de consecutivos. El historial reciente se filtra por fechas reales anteriores al horizonte y se deduplica por día; no utiliza el orden de los archivos como medida temporal. El selector aprende de los menús confirmados/históricos anteriores a la fecha menor entre hoy y el inicio solicitado. Usa seis semanas anteriores al corte más los días previos de esa misma semana, por perfil y momento, y exige dos semanas observadas. La frecuencia general, el mismo día de la semana y el tipo de plato aumentan de forma acotada la probabilidad entre candidatos válidos y con igual prioridad de stock. Las sobras y la compatibilidad con adultos conservan precedencia. No se reescriben los criterios del catálogo. Los bloques con referencias a platos eliminados cuentan como exposición, pero no crean candidatos; los bloques vacíos no se interpretan como preferencias.

## Límites conocidos

- Google puede exigir interacción para emitir una nueva autorización; restaurar sesión vigente y abrir datos locales no necesitan cargar antes su SDK. No se ha añadido backend ni servicio de pago para renovar tokens.
- La cola evita que respuestas antiguas de esta instancia borren cambios nuevos. No ofrece transacciones atómicas entre dos dispositivos o pestañas. Los ficheros distintos de compra conservan la estrategia global del proyecto de último escritor.
- La persistencia de pendientes depende de localStorage; IndexedDB guarda caché. No se ha rediseñado el almacenamiento por cuenta ni la resolución de conflictos de todo el catálogo.
- El fallback existente del generador puede relajar límites cuando el catálogo no ofrece candidatos suficientes. El informe no recalibra frecuencias del catálogo automáticamente. El generador sí aplica preferencias contextuales aprendidas al seleccionar; sin histórico suficiente mantiene pesos neutros.
- La integración OAuth/Drive real, Safari/iOS y la instalación PWA en dispositivos del usuario requieren validación posterior.
