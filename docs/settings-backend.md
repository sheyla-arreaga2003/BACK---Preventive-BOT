# Backend de Configuración

Todas las rutas requieren el encabezado `Authorization: Bearer <token>` y obtienen el usuario desde la sesión validada. No aceptan un identificador de usuario enviado por el frontend.

## Migración

Aplicar en una base de desarrollo, después de respaldarla y confirmar el destino:

```bash
mysql -u <usuario> -p <base> < scripts/migrations/20261027_create_user_settings.sql
```

La migración crea `USER_PREFERENCES` y `USER_MEDIA`. No cambia `USERS` ni completa preferencias para usuarios existentes; cuando no hay una fila guardada, la API devuelve valores predeterminados completos.

Si `USER_PREFERENCES` ya fue creada con la versión inicial del catálogo de acentos, aplicar después, únicamente en el entorno correspondiente, la migración aditiva:

```bash
mysql -u <usuario> -p <base> < scripts/migrations/20261028_expand_user_preference_accent_colors.sql
```

Esta migración conserva las preferencias existentes y amplía solamente los valores permitidos de `UPAccentColor`.

## Perfil

- `GET /api/settings/profile`
- `PATCH /api/settings/profile`

```json
{ "name": "Shey", "email": "shey@example.com" }
```

El correo continúa siendo el identificador de acceso y debe ser único. El nombre es visible y no se usa para iniciar sesión.

Respuesta de consulta o actualización:

```json
{
  "id": 1,
  "name": "Shey",
  "lastName": "Arreaga",
  "email": "shey@example.com",
  "phone": null,
  "role": { "id": 1, "name": "Administrador" },
  "avatarUrl": "/api/settings/avatar"
}
```

`PATCH /profile` admite únicamente `name` y `email`. Los demás datos se entregan como contexto y no son editables mediante Configuración. Los campos desconocidos se rechazan.

- `PUT /api/settings/password`

```json
{ "currentPassword": "<actual>", "newPassword": "<nueva>" }
```

La contraseña actual se verifica con el mismo SHA-256 utilizado por la autenticación existente. La nueva contraseña nunca se devuelve ni se registra.

La nueva contraseña debe tener entre 8 y 128 caracteres. Esta operación admite únicamente `currentPassword` y `newPassword`.

## Preferencias

- `GET /api/settings/preferences`
- `PATCH /api/settings/preferences`
- `DELETE /api/settings/preferences` para restablecer solamente la personalización.

Ejemplo de actualización parcial:

```json
{
  "theme": "dark",
  "accentColor": "purple",
  "background": "gray",
  "compactMenu": true,
  "showChatbot": false,
  "notificationsEnabled": true,
  "homePage": "home",
  "modules": [
    { "id": "home", "visible": true },
    { "id": "plates", "visible": true },
    { "id": "customers", "visible": true },
    { "id": "motorcycles", "visible": true },
    { "id": "maintenance", "visible": true },
    { "id": "reminders", "visible": false },
    { "id": "profile", "visible": true },
    { "id": "settings", "visible": true }
  ]
}
```

Los campos omitidos conservan su valor. Configuración siempre queda visible. Si la pantalla inicial no está visible o permitida, la API usa `home`.

Valores admitidos:

| Campo | Valores |
|---|---|
| `theme` | `light`, `dark`, `system` |
| `accentColor` | `red`, `blue`, `purple`, `green`, `yellow`, `orange`, `sky`, `pink` |
| `background` | `motorcycle`, `gray`, `white`, `custom` |
| `homePage` | identificador permitido y visible del catálogo de módulos |
| `compactMenu` | booleano |
| `showChatbot` | booleano |
| `notificationsEnabled` | booleano |
| `modules` | arreglo ordenado de `{ id, visible }` |

Valores predeterminados:

```json
{
  "theme": "light",
  "accentColor": "red",
  "background": "motorcycle",
  "homePage": "home",
  "compactMenu": false,
  "showChatbot": true,
  "notificationsEnabled": true
}
```

Los módulos permitidos se entregan visibles por defecto en el orden actual del menú. `home` y `settings` no se pueden ocultar. Los módulos omitidos de un arreglo `modules` enviado se consideran ocultos, excepto los módulos fijos; por ello, para reordenar el menú el frontend debe enviar la lista completa en el orden deseado.

Respuesta completa de preferencias:

```json
{
  "theme": "light",
  "accentColor": "red",
  "background": "motorcycle",
  "modules": [
    { "id": "home", "visible": true },
    { "id": "plates", "visible": true },
    { "id": "customers", "visible": true },
    { "id": "motorcycles", "visible": true },
    { "id": "maintenance", "visible": true },
    { "id": "reminders", "visible": true },
    { "id": "profile", "visible": true },
    { "id": "settings", "visible": true }
  ],
  "homePage": "home",
  "compactMenu": false,
  "showChatbot": true,
  "notificationsEnabled": true,
  "customBackgroundUrl": null,
  "capabilities": {
    "personalNotificationsImplemented": false,
    "maintenanceClientEmailsAffected": false
  }
}
```

`GET /api/settings/modules` devuelve el catálogo permitido para el rol autenticado. Personalizar el menú no concede acceso a rutas ni cambia permisos.

La respuesta de preferencias incluye:

```json
{
  "capabilities": {
    "personalNotificationsImplemented": false,
    "maintenanceClientEmailsAffected": false
  }
}
```

La preferencia de notificaciones queda persistida para una integración futura, pero actualmente no controla un servicio personal. Tampoco desactiva los recordatorios de mantenimiento enviados a clientes.

### Contrato pendiente con Notificaciones

No se crearon rutas, tablas, contadores, tareas, eventos ni envíos de notificaciones personales. Guardar `notificationsEnabled` únicamente conserva la decisión del usuario.

Cuando se implemente el servicio administrativo de Notificaciones, el backend podrá consultar:

```ts
await settingsService.personalNotificationsPreference(userId)
```

El método devuelve el valor persistido del usuario o `true` cuando todavía no existe una fila de preferencias. El servicio futuro deberá decidir en qué operaciones se consulta y qué canales controla. No debe aplicar este valor a los recordatorios ni a los correos de mantenimiento destinados a clientes.

## Avatar y fondo personalizado

- `GET|PUT|DELETE /api/settings/avatar`
- `GET|PUT|DELETE /api/settings/background-image`

En `PUT` se envía el archivo como cuerpo binario con `Content-Type: image/png`, `image/jpeg` o `image/webp`. El máximo es 2 MB. El servidor valida la firma real, genera un identificador y guarda una sola imagen de cada tipo por usuario en MySQL.

Respuesta de subida:

```json
{
  "url": "/api/settings/avatar",
  "mimeType": "image/png",
  "size": 84521
}
```

Respuesta de eliminación:

```json
{ "deleted": true }
```

Ejemplo en frontend:

```ts
await fetch("/api/settings/avatar", {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": file.type,
  },
  body: file,
});
```

Para mostrar la imagen protegida, el frontend debe descargarla con el token, crear un `Blob` y utilizar `URL.createObjectURL`. No debe colocar directamente la ruta en `<img src>` porque el navegador no agrega el encabezado Bearer automáticamente.

## Correspondencia con los controles

- Nombre y correo: `PATCH /profile`.
- Cambiar contraseña: `PUT /password`.
- Cambiar avatar: `PUT /avatar`; predeterminado: `DELETE /avatar`.
- Tema, acento, fondo, módulos, pantalla inicial, menú compacto, chatbot y notificaciones: un `PATCH /preferences` parcial o conjunto al presionar Guardar cambios.
- Subir fondo: `PUT /background-image` y luego `PATCH /preferences` con `background: "custom"`.
- Restablecer ajustes: `DELETE /preferences`. No modifica perfil, contraseña, avatar, roles ni datos del negocio.

## Pasos de integración del frontend

1. Agregar las rutas anteriores al catálogo de endpoints del frontend.
2. Usar el token administrativo existente en todas las solicitudes.
3. Cargar `GET /profile`, `GET /preferences` y `GET /modules` al abrir Configuración.
4. Construir el menú únicamente con módulos permitidos; ocultarlos no debe sustituir las protecciones de rutas.
5. Enviar la lista completa de módulos cuando cambie el orden.
6. Usar actualizaciones parciales para guardar solamente los controles modificados.
7. Descargar avatar y fondo mediante `fetch` autenticado, convertir la respuesta a `Blob` y crear una URL local.
8. Revocar las URL creadas con `URL.revokeObjectURL` cuando se reemplacen o desmonten.
9. Subir primero el fondo personalizado y después guardar `background: "custom"`.
10. Mostrar la preferencia de notificaciones como preparada pero no afirmar que activa, silencia o entrega avisos reales.

No se agregaron variables de entorno ni dependencias nuevas.

## Verificación en desarrollo (27 de octubre de 2026)

La migración `scripts/migrations/20261027_create_user_settings.sql` se aplicó en la base local de desarrollo `mototec`, ejecutada por MySQL en la misma Mac. Antes de escribir se comprobó que el host de base de datos fuera `127.0.0.1` y que el servidor reportara el equipo local. No se utilizaron ni modificaron datos de producción.

La verificación HTTP se realizó con el backend local en un puerto aislado, autenticación JWT real y sesiones Redis bajo un prefijo exclusivo de prueba. Se crearon dos administradores ficticios identificables y se eliminaron al terminar. También se retiraron sus claves temporales de Redis.

Se comprobaron satisfactoriamente:

- valores predeterminados completos cuando no existe una fila en `USER_PREFERENCES`;
- guardado, recuperación, actualización parcial y aislamiento por usuario;
- visibilidad obligatoria de Inicio y Configuración, orden de módulos permitido por el rol y validación de la pantalla inicial;
- edición de nombre y correo, rechazo de correo duplicado y cambio de contraseña verificando la contraseña actual;
- carga, lectura, reemplazo y eliminación de avatar;
- carga y lectura de fondo personalizado;
- aceptación de PNG, JPEG y WebP válidos, rechazo de contenido inválido y del límite superior a 2 MB;
- persistencia de preferencias e imágenes después de reiniciar el backend local;
- restablecimiento exclusivo de preferencias sin modificar perfil, contraseña, rol, imágenes ni tablas de negocio;
- persistencia de `notificationsEnabled` sin correos, eventos, tareas ni efectos sobre recordatorios de clientes.

La prueba automatizada del servicio de Configuración y la suite completa del backend se ejecutan con `pnpm test`; la comprobación de tipos se ejecuta con `pnpm typecheck`. Las pruebas reales contra MySQL no forman parte de la suite ordinaria porque crean datos temporales y requieren servicios locales disponibles.

Notificaciones continúa fuera del alcance. Solamente están disponibles la preferencia `notificationsEnabled`, el método interno de consulta futura y las banderas `personalNotificationsImplemented: false` y `maintenanceClientEmailsAffected: false`.
