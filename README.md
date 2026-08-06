# MenuApp — Guía de construcción paso a paso

> Aplicación web familiar para gestionar menús, despensa y lista de la compra.  
> Stack: HTML + CSS + JavaScript vanilla · GitHub Pages · Google Drive API

---

## ANTES DE EMPEZAR — Lo que necesitas

- Una cuenta de **GitHub** (gratuita)
- Una cuenta de **Google** (la que usas normalmente)
- **Git** instalado en tu ordenador ([descargar](https://git-scm.com/downloads))
- Un editor de código — recomiendo **VS Code** ([descargar](https://code.visualstudio.com/))

---

## FASE 0 — Infraestructura base

### PASO 1 — Clonar o subir el proyecto a GitHub

#### Opción A (recomendada): desde terminal

```bash
# 1. Crea la carpeta del proyecto en tu ordenador
cd ~/Documents   # o donde prefieras
mkdir menuapp
cd menuapp

# 2. Inicializa git y conecta con GitHub
git init
git add .
git commit -m "feat: Fase 0 - infraestructura base"

# 3. Ve a github.com, crea un repositorio PÚBLICO llamado "menuapp"
#    (sin inicializar — sin README, sin .gitignore)

# 4. Conecta tu carpeta local con GitHub (sustituye TU_USUARIO)
git remote add origin https://github.com/TU_USUARIO/menuapp.git
git branch -M main
git push -u origin main
```

#### Opción B: desde la web de GitHub

1. Ve a [github.com/new](https://github.com/new)
2. Nombre del repositorio: `menuapp`
3. Visibilidad: **Public** (obligatorio para GitHub Pages gratuito)
4. NO marques "Add README" ni nada — repositorio vacío
5. Pulsa **Create repository**
6. En la página siguiente, copia el enlace HTTPS del repo
7. Arrastra la carpeta `menuapp` a GitHub Desktop (si lo tienes) o usa la web para subir ficheros

---

### PASO 2 — Activar GitHub Pages

1. Ve a tu repositorio en GitHub
2. Pulsa **Settings** (arriba a la derecha)
3. En el menú lateral: **Pages**
4. En **Source**: selecciona `Deploy from a branch`
5. Branch: `main` / Folder: `/ (root)`
6. Pulsa **Save**
7. Espera 2-3 minutos
8. Tu app estará disponible en: `https://TU_USUARIO.github.io/menuapp/`

> ⚠️ Anota esta URL — la necesitarás en el Paso 3.

---

### PASO 3 — Crear el proyecto en Google Cloud Console

Este paso configura Google para que tu app pueda acceder a Google Drive.

#### 3.1 Crear el proyecto

1. Ve a [console.cloud.google.com](https://console.cloud.google.com)
2. Inicia sesión con tu cuenta de Google
3. Arriba a la izquierda, pulsa el selector de proyectos → **Nuevo proyecto**
4. Nombre: `MenuApp` → **Crear**
5. Asegúrate de que el proyecto `MenuApp` está seleccionado

#### 3.2 Habilitar Google Drive API

1. Menú izquierdo → **APIs y servicios** → **Biblioteca**
2. Busca: `Google Drive API`
3. Pulsa el resultado → **Habilitar**

#### 3.3 Configurar la pantalla de consentimiento OAuth

1. Menú izquierdo → **APIs y servicios** → **Pantalla de consentimiento de OAuth**
2. Tipo de usuario: **Externo** → **Crear**
3. Rellena:
   - **Nombre de la app**: `MenuApp`
   - **Email de asistencia**: tu email
   - **Email del desarrollador**: tu email
4. Pulsa **Guardar y continuar**
5. En "Permisos" no añadas nada → **Guardar y continuar**
6. En "Usuarios de prueba" → **Añadir usuarios**:
   - Añade tu email de Google
   - Añade el email de tu mujer
7. **Guardar y continuar** → **Volver al panel**

> ℹ️ Al estar en modo "Prueba" solo los usuarios que añadas pueden acceder. Para producción se publicaría, pero para uso familiar con 2 usuarios esto es suficiente.

#### 3.4 Crear las credenciales OAuth (Client ID)

1. Menú izquierdo → **APIs y servicios** → **Credenciales**
2. Pulsa **+ Crear credenciales** → **ID de cliente de OAuth**
3. Tipo de aplicación: **Aplicación web**
4. Nombre: `MenuApp Web`
5. En **Orígenes de JavaScript autorizados**, pulsa **+ Añadir URI** y añade:
   ```
   https://TU_USUARIO.github.io
   ```
   Si también vas a probar en local:
   ```
   http://localhost:8080
   http://localhost:5500
   ```
6. En **URIs de redirección autorizadas**: deja vacío (no se necesitan con el flujo que usamos)
7. Pulsa **Crear**
8. **Copia el "ID de cliente"** — tiene esta forma:
   ```
   123456789-abcdefgh.apps.googleusercontent.com
   ```

---

### PASO 4 — Configurar el Client ID en el código

1. Abre el fichero `js/auth.js` en tu editor
2. Busca esta línea:
   ```javascript
   const GOOGLE_CLIENT_ID = 'TU_CLIENT_ID_AQUI.apps.googleusercontent.com';
   ```
3. Sustituye `TU_CLIENT_ID_AQUI.apps.googleusercontent.com` por el Client ID que copiaste
4. Guarda el fichero

---

### PASO 5 — Generar los iconos PNG

Los iconos PNG son necesarios para que la app funcione como PWA.

#### Opción A: generar con Python (recomendado)

```bash
pip install cairosvg
python docs/generar-iconos.py
```

#### Opción B: manual (sin instalar nada)

1. Ve a [svgtopng.com](https://svgtopng.com) o similar
2. Sube el fichero `assets/icons/icon.svg`
3. Exporta en tamaño 192×192 → guárdalo como `assets/icons/icon-192.png`
4. Exporta en tamaño 512×512 → guárdalo como `assets/icons/icon-512.png`

---

### PASO 6 — Subir todo a GitHub y verificar

```bash
git add .
git commit -m "feat: Fase 0 completada — Client ID configurado e iconos añadidos"
git push
```

Espera 1-2 minutos y abre tu app en:
```
https://TU_USUARIO.github.io/menuapp/
```

---

### PASO 7 — Verificar que la Fase 0 funciona

Abre la URL de GitHub Pages y comprueba:

- [ ] Se muestra la pantalla de login con el botón "Acceder con Google"
- [ ] Al pulsar el botón se abre la ventana de Google para seleccionar cuenta
- [ ] Después del login aparece la app con el dashboard
- [ ] En el bloque "Estado del sistema" aparece: "✓ Google Drive conectado"
- [ ] Se muestra tu nombre y email
- [ ] La bottom navigation funciona y muestra las 5 secciones
- [ ] La sección "Despensa" muestra el botón "Añadir" (aunque vacía)
- [ ] Puedes añadir un artículo de prueba y se guarda

Si algo falla, consulta la sección **Solución de problemas** al final de este README.

---

### PASO 8 — Dar acceso a tu mujer

1. Ve a Google Cloud Console → **APIs y servicios** → **Pantalla de consentimiento de OAuth** → **Usuarios de prueba**
2. Confirma que el email de tu mujer está en la lista
3. Comparte la URL `https://TU_USUARIO.github.io/menuapp/` con ella
4. Ella accede con su Google y verá los mismos datos (compartidos por el mismo Drive de la cuenta que configuró el Client ID)

> ⚠️ **Importante**: los datos se guardan en el Google Drive de **quien inicia sesión**. Para que ambos veáis los mismos datos, ambos deben iniciar sesión con **la misma cuenta de Google** (la tuya), o en Fase 5 se implementará la compartición real de carpeta Drive entre dos cuentas distintas.

---

## Estructura de carpetas del proyecto

```
menuapp/
├── index.html              ← Punto de entrada
├── manifest.json           ← Configuración PWA
├── service-worker.js       ← Caché offline y notificaciones
├── css/
│   └── main.css            ← Todos los estilos (Mobile First)
├── js/
│   ├── app.js              ← Controlador principal
│   ├── auth.js             ← Autenticación Google OAuth 2.0
│   ├── drive.js            ← Capa de datos (Google Drive API)
│   ├── sync.js             ← Sincronización entre usuarios
│   ├── utils/
│   │   ├── storage.js      ← IndexedDB (caché local)
│   │   ├── dates.js        ← Utilidades de fechas
│   │   └── ui.js           ← Toast, modales, navegación
│   └── modules/
│       ├── inventario.js   ← Módulo de despensa (Fase 1)
│       ├── platos.js       ← Catálogo de platos (Fase 2)
│       ├── menu.js         ← Generador de menús (Fase 3)
│       ├── compra.js       ← Lista de la compra (Fase 4)
│       ├── historial.js    ← Historial de menús (Fase 6)
│       └── configuracion.js← Configuración (Fase 5)
├── assets/
│   └── icons/
│       ├── icon.svg        ← Icono fuente
│       ├── icon-192.png    ← Icono PWA (generar con script)
│       └── icon-512.png    ← Icono PWA grande (generar con script)
├── data/
│   └── supermercados.json  ← Datos de seed de supermercados
└── docs/
    ├── generar-iconos.py   ← Script para generar PNGs
    └── README.md           ← Esta guía
```

---

## Estructura en Google Drive (se crea automáticamente)

```
MenuApp/
├── inventario.json         ← Stock de despensa
├── platos.json             ← Catálogo de platos
├── config.json             ← Configuración global
├── supermercados.json      ← Supermercados y secciones
├── menus/
│   └── semana_YYYY-MM-DD.json
├── compras/
│   ├── compra_YYYY-MM-DD.json
│   └── compra_YYYY-MM-DD.xlsx
└── backups/
    └── inventario_YYYY-MM-DD.json
```

---

## Roadmap de fases

| Fase | Qué hace | Estado |
|------|----------|--------|
| 0 | Infraestructura: GitHub Pages + OAuth + Drive | ✅ Esta guía |
| 1 | Inventario completo (CRUD despensa) | 🔜 Siguiente |
| 2 | Catálogo de platos | 🔜 |
| 3 | Generador de menús + edición | 🔜 |
| 4 | Lista de la compra + modo compra | 🔜 |
| 5 | Notificaciones + sincronización multi-usuario | 🔜 |
| 6 | IA local + PWA completa + pulido UX | 🔜 |

---

## Solución de problemas frecuentes

### "Error al iniciar sesión" al pulsar el botón de Google

- Verifica que el `GOOGLE_CLIENT_ID` en `js/auth.js` es correcto (sin espacios)
- Verifica que la URL de tu GitHub Pages está en "Orígenes autorizados" en Google Cloud Console
- Verifica que tu email está en la lista de "Usuarios de prueba"

### "Error: No se pudo cargar el SDK de Google Identity Services"

- Comprueba que tienes conexión a internet
- Puede ser un bloqueador de anuncios — prueba en modo incógnito

### La app funciona en PC pero no en iPhone

- En Safari, la app debe estar instalada como PWA (Compartir → Añadir a pantalla de inicio) para que las notificaciones push funcionen
- Asegúrate de abrir la URL exacta con `https://` (no `http://`)

### Los datos no se sincronizan entre los dos usuarios

- En Fase 0, ambos deben usar la misma cuenta de Google
- La sincronización entre cuentas distintas se implementa en Fase 5

### "Sin conexión a Drive" en el dashboard

- El token de Google puede haber caducado (duran 1 hora) — cierra sesión y vuelve a entrar
- Verifica que la Google Drive API está habilitada en Google Cloud Console

---

## Próximo paso: Fase 1 — Inventario completo

Cuando hayas verificado que la Fase 0 funciona correctamente, di "Aprobado, continúa con la Fase 1" y se generará el código completo del módulo de inventario con:

- Listado por ubicación con filtros
- Formulario completo de alta/edición/baja
- Ajuste rápido de cantidad
- Indicadores visuales de caducidad
- Forzar uso en el generador de menú
