# MenuApp

PWA familiar de menús, platos, despensa y compra. HTML, CSS y JavaScript sin framework, con caché local y sincronización mediante Google Drive. Publicación existente en GitHub Pages y despliegue de servidor preparado en Cloudflare Workers.

## Uso

- Inicio abre con los datos locales. En Cloudflare, tras autorizar Google una primera vez, recupera y renueva automáticamente la sesión sin pulsar Conectar; reintenta al volver a la app o recuperar la red. La sesión del dispositivo dura hasta 90 días, salvo revocación o restricciones de Google. Cerrar sesión impide la recuperación automática. En GitHub Pages se mantiene la conexión manual al caducar el token.
- La activación en Cloudflare requiere configurar el cliente OAuth existente: [sesión persistente y migración](docs/sesion-google.md).
- **Más** abre Artículos, Historial y Configuración.
- **Menú** muestra solo la semana actual (desde el lunes) y las futuras disponibles. El selector permite editar cualquiera de los menús visibles, incluidas sus semanas si abarcan más de una.
- Los calendarios de Inicio, Menú y edición mantienen filas de altura fija, alineadas con la cabecera y la columna izquierda. Solo se desplazan horizontalmente; el gesto vertical mueve la página. Los nombres que exceden la altura fija se recortan visualmente y se conservan completos en el selector de platos del editor.
- **Menú → Historial** abre todos los menús guardados: primero el actual, después los anteriores de más reciente a más antiguo y, al final, los futuros. También sigue accesible desde **Más**. Al abrir un menú, **Editar menú** permite modificar cualquier semana pasada.
- **Guardar cambios** actualiza el archivo original de Drive y vuelve a la vista de origen. Cancelar no guarda; si falla el envío, conserva la edición para reintentar. Editar un menú pasado o futuro no sustituye la semana activa ni elimina sus avisos.
- Las búsquedas de nombres ignoran tildes y mayúsculas.
- **Configuración → Generador** permite elegir entre 2 y 12 semanas de histórico; por defecto usa 4 (28 días anteriores a hoy o al comienzo del menú, si es anterior). Aprende por adulto/bebé, comida/cena, día de la semana, laborable/fin de semana, facilidad y parejas de platos. Necesita dos semanas observadas; los días ausentes no se interpretan como rechazo. Da preferencia a la rutina y conserva espacio para novedades, con prioridad para el stock y el reaprovechamiento.
- Las cenas adultas admiten una preparación catalogada como primero, segundo o único si es compatible con cena. El permiso de repetición también se respeta para adultos: una vez por semana sin permiso, hasta dos con permiso, evitando días consecutivos. Los segundos de un día fácil también deben ser fáciles.
- En el paso de **Días especiales**, **Bebé: solo cenas de lunes a viernes** excluye sus comidas laborables en todas las semanas del borrador. Empieza desactivado en cada menú nuevo; conserva la elección al avanzar y volver. Respeta adultos, fines de semana y las exclusiones de los días especiales. En el calendario de edición puedes abrir cualquier celda marcada fuera y añadir una excepción manual para adultos o bebé; queda guardada en ese día.
- Compra mantiene una lista atemporal. **Guardar lista** publica explícitamente los cambios; sus controles y **Cerrar compra** permanecen en la parte superior al desplazarse. Cerrar retira únicamente los artículos comprados.
- Al combinar la lista se conserva la edición más reciente de cada artículo, incluidas reducciones de cantidad. Los datos antiguos sin fecha o con igual fecha conservan la cantidad mayor. Las marcas de retirada impiden recuperar copias anteriores de artículos eliminados.
- Historial → **Analizar hábitos** describe los menús anteriores a hoy, agrupados de lunes a domingo, por plato, perfil y comida/cena. Distingue semanas completas y parciales, compara intervalos observados y configuración, y permite exportar un JSON con las fuentes. Describe planificación; no confirma consumo ni modifica automáticamente los platos.

## Desarrollo local

El frontend estático no requiere instalación de dependencias ni compilación:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Abrir `http://127.0.0.1:8080`. Para probar OAuth real, este origen debe estar autorizado en el proyecto Google existente. La guía de infraestructura está en [README_docs.md](README_docs.md).

## Pruebas

Node.js 22.13 o posterior (las pruebas del servidor utilizan SQLite integrado):

```sh
node --test tests/*.test.cjs
```

La batería de navegador utiliza Playwright y Chrome disponibles en el equipo. El servidor de prueba arranca automáticamente en un puerto local temporal:

```sh
PLAYWRIGHT_MODULE=/ruta/a/node_modules/playwright node tests/browser.cjs
```

Si `playwright` está disponible en la resolución normal de Node, basta `node tests/browser.cjs`. Las capturas se guardan en la carpeta temporal del sistema, dentro de `menuapp-qa`; puede elegirse otra carpeta con `MENUAPP_QA_OUTPUT`. `MENUAPP_BROWSER_CHANNEL` permite cambiar el canal instalado de navegador.

Las pruebas de interfaz usan datos ficticios y bloquean servicios externos. Verifican el filtrado de semanas, el orden del historial, la edición y guardado de menús pasados/futuros, la cancelación y el reintento de errores. También verifican una recarga offline real con Service Worker e IndexedDB. También comprueban restauración de sesión de servidor, recuperación tras fallo temporal, recarga y cierre con respuestas simuladas. Los tests de backend verifican OAuth, renovación, cifrado, caducidad y protección CSRF. No autorizan ni escriben en el Drive personal.

## Contexto y revisión

- [Mapa funcional y técnico](docs/CONTEXTO.md).
- [Revisión del audio del 13/11/2026 y validaciones pendientes](docs/revision-2026-11-13.md).
- [Hábitos configurables y asistente de bebé del 15/11/2026](docs/revision-2026-11-15.md).

La revisión del 13/11/2026 se integró en `main` con autorización del usuario. La revisión del 15/11/2026 se prepara en una rama independiente, pendiente de validación y autorización de integración. Los datos personales exportados, el catálogo revisado y su copia original se entregan por separado; no se incorporan al repositorio. El generador usa el histórico autorizado en Drive al crear cada menú; los cambios de código no sobrescriben automáticamente `platos.json`.
