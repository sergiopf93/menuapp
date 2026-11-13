# MenuApp

PWA familiar de menús, platos, despensa y compra. HTML, CSS y JavaScript sin framework, con caché local y sincronización mediante Google Drive. Publicación existente en GitHub Pages.

## Uso

- Inicio abre con los datos locales. Una sesión de Google vigente sincroniza en segundo plano; si caduca, **Conectar con Google** permite renovar la autorización sin bloquear el uso local.
- **Más** abre Artículos, Historial y Configuración.
- Menú abre en la semana actual y conserva el desplazamiento lateral hacia otras semanas.
- Las búsquedas de nombres ignoran tildes y mayúsculas.
- El generador adapta la elección a los menús confirmados de las seis semanas anteriores y los días ya transcurridos de la semana del corte: frecuencia del plato, día de la semana, comida/cena y adulto/bebé. Necesita dos semanas observadas por perfil y momento; sin ellas utiliza selección neutral. Conserva stock, sobras y reglas del catálogo; las novedades siguen teniendo oportunidad.
- Compra mantiene una lista atemporal. **Guardar lista** publica explícitamente los cambios; sus controles y **Cerrar compra** permanecen en la parte superior al desplazarse. Cerrar retira únicamente los artículos comprados.
- Al combinar la lista se conserva la edición más reciente de cada artículo, incluidas reducciones de cantidad. Los datos antiguos sin fecha o con igual fecha conservan la cantidad mayor. Las marcas de retirada impiden recuperar copias anteriores de artículos eliminados.
- Historial → **Analizar hábitos** describe los menús anteriores a hoy, agrupados de lunes a domingo, por plato, perfil y comida/cena. Distingue semanas completas y parciales, compara intervalos observados y configuración, y permite exportar un JSON con las fuentes. Describe planificación; no confirma consumo ni modifica automáticamente los platos.

## Desarrollo local

No requiere instalación de dependencias ni compilación:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Abrir `http://127.0.0.1:8080`. Para probar OAuth real, este origen debe estar autorizado en el proyecto Google existente. La guía de infraestructura está en [README_docs.md](README_docs.md).

## Pruebas

Node.js 22 o posterior:

```sh
node --test tests/*.test.cjs
```

La batería de navegador utiliza Playwright y Chrome disponibles en el equipo. El servidor de prueba arranca automáticamente en un puerto local temporal:

```sh
PLAYWRIGHT_MODULE=/ruta/a/node_modules/playwright node tests/browser.cjs
```

Si `playwright` está disponible en la resolución normal de Node, basta `node tests/browser.cjs`. Las capturas se guardan en la carpeta temporal del sistema, dentro de `menuapp-qa`; puede elegirse otra carpeta con `MENUAPP_QA_OUTPUT`. `MENUAPP_BROWSER_CHANNEL` permite cambiar el canal instalado de navegador.

Las pruebas de interfaz usan datos ficticios y bloquean servicios externos. También verifican una recarga offline real con Service Worker e IndexedDB. No autorizan ni escriben en el Drive personal.

## Contexto y revisión

- [Mapa funcional y técnico](docs/CONTEXTO.md).
- [Revisión del audio del 13/11/2026 y validaciones pendientes](docs/revision-2026-11-13.md).

La rama de revisión requiere validación del usuario antes de integrarse en `main`. El generador calcula las preferencias al generar desde el histórico de Drive autorizado en la propia app. Su ajuste a la familia requiere validación con los datos reales; no se han cambiado automáticamente las frecuencias mínimas de los platos.
