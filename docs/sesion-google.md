# Sesión de Google persistente

## Activación pendiente

El servidor se prepara en `https://menuapp.sergio-pf93-794.workers.dev`. La URL anterior de GitHub Pages conserva su autenticación y no redirige automáticamente. No cambiar la instalación PWA hasta completar la autorización y comprobar Drive en el nuevo origen.

En Google Cloud → Google Auth Platform → Clientes (o APIs y servicios → Credenciales), abrir **el cliente web existente**:

`239981851235-35btnur92qg9to032gtvn8guocodpfph.apps.googleusercontent.com`

1. Añadir el URI de redirección autorizado exacto:
   `https://menuapp.sergio-pf93-794.workers.dev/auth/callback`.
2. Conservar los orígenes existentes para GitHub Pages. El nuevo flujo usa redirección al servidor; no necesita el SDK de navegador ni un origen JavaScript nuevo.
3. Guardar el secreto de ese cliente en Cloudflare → Workers & Pages → `menuapp` → Settings → Variables and Secrets, tipo **Secret**, nombre `GOOGLE_CLIENT_SECRET`. No ponerlo en JavaScript, Git, capturas ni chat. También puede introducirse en el prompt de `npx wrangler@4.143.0 secret put GOOGLE_CLIENT_SECRET` desde el repositorio.
4. Si la audiencia externa está en **Testing**, Google caduca la autorización offline a los siete días. Para evitar esa caducidad semanal, revisar y cambiar el estado de publicación a **Production** desde Google Auth Platform → Audience; Google puede exigir pasos adicionales según su configuración. No se cambia ese estado automáticamente. [Condiciones oficiales de expiración](https://developers.google.com/identity/protocols/oauth2#expiration).
5. Abrir la nueva dirección, pulsar **Conectar con Google** una vez y autorizar con la cuenta habitual. Comprobar menús y datos existentes, recargar y confirmar que se recupera la conexión sin pulsar ningún botón. Comprobar de nuevo tras una hora y tras cerrar/reabrir el navegador. Esta validación real está pendiente; las pruebas automatizadas simulan las respuestas de Google.

Se mantiene el Client ID para conservar el acceso `drive.file` a los archivos creados por MenuApp. Antes de cambiar de URL, guardar/sincronizar los cambios locales de la dirección anterior: IndexedDB, cola de pendientes, preferencias locales y la instalación PWA pertenecen a cada origen. En la nueva URL se recuperan los datos de Drive, no la caché de la URL antigua. Instalar la nueva PWA solo después de validar esa recuperación.

## Funcionamiento

- Cookie opaca `Secure`, `HttpOnly`, `SameSite=Lax`, con duración máxima de 90 días. Google, el usuario o el navegador pueden invalidar antes la autorización o la cookie.
- OAuth Authorization Code con PKCE y estado de un solo uso ligado al navegador. La autorización inicial sigue requiriendo consentimiento.
- D1 guarda identificadores de sesión derivados con SHA-256 y el contenido cifrado con AES-GCM. La credencial de renovación nunca llega al navegador. El access token temporal vive en memoria y se usa para las llamadas existentes a Drive.
- La apertura, reentrada y vuelta de la red recuperan la sesión; Drive comprueba el token antes de cada petición. Un fallo temporal conserva la sesión y permite reintentar. Sin conexión se mantiene el uso local.
- Cerrar sesión elimina la sesión de ese dispositivo y borra su cookie; no revoca otros dispositivos. El flujo existente de cierre también limpia la caché local. El access token temporal ya emitido puede ser válido hasta su expiración en Google.
- `/auth/*` exige mismo origen, no ofrece CORS ni se almacena en el Service Worker. La limpieza diaria elimina registros caducados. La observabilidad del Worker está desactivada para no registrar códigos OAuth en URLs.

## Despliegue

Usa la infraestructura existente de Cloudflare, sin activar planes ni servicios de pago. Workers/D1 tienen límites gratuitos; no se configura ampliación automática de plan. Consultar [Workers](https://developers.cloudflare.com/workers/platform/pricing/) y [D1](https://developers.cloudflare.com/d1/platform/pricing/) antes de cambiar el plan o ampliar el uso.

Node.js 22.13+; Wrangler 4.143.0:

```sh
node --test tests/*.test.cjs
npx wrangler@4.143.0 d1 migrations apply menuapp-auth --remote
npx wrangler@4.143.0 deploy --dry-run
npx wrangler@4.143.0 deploy
```

`wrangler.toml` contiene el origen, Client ID público y binding de la base `menuapp-auth`. No contiene secretos. El build copia únicamente los recursos del frontend a `dist/` y activa `MENUAPP_SERVER_AUTH` en esa copia; GitHub Pages y el servidor estático local conservan el modo anterior.

Secretos necesarios en el Worker:

- `GOOGLE_CLIENT_SECRET`: del cliente web existente.
- `SESSION_ENCRYPTION_KEY`: 32 bytes aleatorios codificados base64url, generados para este despliegue y guardados directamente como secreto de Cloudflare. No regenerar en cada despliegue: cambiarla invalida las sesiones cifradas existentes.

La migración crea únicamente `oauth_flows` y `auth_sessions`, con índices de caducidad. No modifica Drive ni la base de Health Tracker. Los despliegues siguientes conservan base y secretos; no los incluyas en archivos públicos. No hay despliegue automático de Workers al hacer push: ejecutar el comando de despliegue después de validar el cambio.

## Validación

Los tests Node comprueban el backend sobre SQLite real con Google simulado: PKCE/estado, callbacks reutilizados/caducados, cookies, cifrado, CSRF, renovación, revocación, cierre por dispositivo y fallos temporales. El frontend verifica solicitudes concurrentes, ausencia de tokens persistidos, carreras con cierre y recuperación offline. La batería Chrome comprueba inicio/reentrada/recarga/cierre sin SDK, además de la regresión de menús, compra y modo offline.

El empaquetado de Wrangler se verifica por separado. El flujo OAuth real necesita completar la configuración anterior; no se sustituye esa validación por las pruebas simuladas. La ejecución local del runtime de Workers no está validada en macOS 12.6 (Wrangler requiere macOS 13.5+ para esa modalidad).
