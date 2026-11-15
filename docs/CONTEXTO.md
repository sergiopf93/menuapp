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

El generador respeta los criterios configurados del catálogo. Los contadores semanales reinician el lunes, manteniendo continuidad de sobras y prohibición de consecutivos. El historial reciente se filtra por fechas reales anteriores al horizonte y se deduplica por día; no utiliza el orden de los archivos como medida temporal. El selector aprende de los menús confirmados/históricos anteriores a la fecha menor entre hoy y el inicio solicitado. Usa exactamente 7 × N días anteriores al corte, con N configurable entre 2 y 12 (defecto 4), por perfil y momento, y exige dos semanas observadas. La frecuencia general, el mismo día de la semana, el tipo de plato, la clase de jornada (laborable/fin de semana), la facilidad y las parejas habituales aumentan de forma acotada la probabilidad entre candidatos válidos y con igual prioridad de stock. Con evidencia suficiente y alternativas de ambos grupos, el selector combina un 80 % de masa para platos observados y un 20 % para todos los candidatos; las novedades conservan probabilidad. Las tasas de jornada usan exposición real y mínimo dos semanas por grupo; las parejas requieren dos apariciones. La cena adulta admite una preparación de cualquier tipo compatible con cena. Los adultos respetan permiteRepeticion (1 o 2 días por semana) y no usan consecutivos, incluso en el último recurso. Los segundos de días fáciles también deben ser fáciles. Las sobras y la compatibilidad con adultos conservan precedencia. No se reescriben los criterios del catálogo. Los bloques con referencias a platos eliminados cuentan como exposición, pero no crean candidatos; los bloques vacíos no se interpretan como preferencias.

## Límites conocidos

- Google puede exigir interacción para emitir una nueva autorización; restaurar sesión vigente y abrir datos locales no necesitan cargar antes su SDK. No se ha añadido backend ni servicio de pago para renovar tokens.
- La cola evita que respuestas antiguas de esta instancia borren cambios nuevos. No ofrece transacciones atómicas entre dos dispositivos o pestañas. Los ficheros distintos de compra conservan la estrategia global del proyecto de último escritor.
- La persistencia de pendientes depende de localStorage; IndexedDB guarda caché. No se ha rediseñado el almacenamiento por cuenta ni la resolución de conflictos de todo el catálogo.
- El fallback del generador puede relajar el intervalo entre semanas y reglas de equilibrio cuando faltan candidatos; conserva el permiso de repetición adulto, separación de días y facilidad explícita. Puede dejar un bloque vacío si no hay candidatos compatibles. El informe no recalibra frecuencias del catálogo automáticamente. El generador sí aplica preferencias contextuales aprendidas al seleccionar; sin histórico suficiente mantiene pesos neutros.
- La integración OAuth/Drive real, Safari/iOS y la instalación PWA en dispositivos del usuario requieren validación posterior.

## Revisión del 15/11/2026

`config.configuracionMenus.semanasHistorialHabitos` es un entero de 2 a 12; valores ausentes o inválidos se interpretan como 4. El guardado conserva otras claves de configuracionMenus. El modelo se registra en `adaptacionHabitos.version=2` y `ventanaSemanas` con la ventana efectiva. Para no recortar restricciones anteriores, la carga de menús mantiene al menos seis semanas; el modelo de preferencias filtra por la ventana elegida.

`bebeSoloCenasLaborables` pertenece al borrador/menú, no a la configuración global. Es false al iniciar. Al activarlo, el motor pone `_bebeActivo=false` solo en comidas de lunes a viernes, combinado con días especiales. Calendarios normal y editable distinguen cancelación por perfil. Una cena bebé sin preparaciones compartidas ni sobras busca un plato compatible propio; cuando puede reaprovechar la pareja adulta del mediodía, conserva ambos platos.

La revisión manual del catálogo se realiza sobre una exportación aportada por el usuario. El catálogo revisado conserva IDs y datos de recetas; se entrega con original y motivos fuera de Git. La aplicación no ejecuta migraciones automáticas de datos personales.
