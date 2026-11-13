# Backend del módulo Perfil

## Alcance

El módulo reutiliza el perfil, contraseña y avatar ya disponibles en Configuración y agrega resumen de actividad, historial paginado y administración de sesiones del administrador autenticado. No agrega funciones al frontend ni implementa Notificaciones.

La API no inventa campos que no existen en el esquema. En particular, no expone nombre de usuario independiente, agencia, estado de cuenta ni un último acceso anterior a esta implementación. `USFregister` se conserva como fecha existente del usuario y `USLastLoginAt` guarda únicamente inicios de sesión exitosos posteriores a la migración.

## Migración de desarrollo

Archivo: `scripts/migrations/20261029_create_profile_activity.sql`.

La migración:

- agrega `USERS.USLastLoginAt`, inicialmente `NULL`;
- crea `USER_ACTIVITY` con el administrador actor, tipo de evento, entidad, identificador y fecha UTC;
- no atribuye operaciones históricas;
- no modifica datos de clientes, motocicletas, placas o mantenimientos.

Antes de aplicarla se debe confirmar explícitamente que la conexión apunta a desarrollo, respaldar el esquema afectado y comprobar que la columna y la tabla no existen. El rollback explícito se encuentra en `scripts/migrations/rollback/20261029_drop_profile_activity.sql`; elimina los datos nuevos, por lo que solo debe usarse después de respaldarlos y validar el entorno.

Después de confirmar el entorno, se puede aplicar desde la raíz del backend sin escribir la contraseña en el comando (el cliente la solicitará):

```bash
mysql --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" --password "$DB_NAME" \
  < scripts/migrations/20261029_create_profile_activity.sql
```

La verificación posterior debe confirmar `USERS.USLastLoginAt` y `USER_ACTIVITY` con `SHOW COLUMNS`/`SHOW CREATE TABLE`, y luego ejecutar las pruebas HTTP con una cuenta de prueba. No debe ejecutarse el rollback durante una instalación normal.

## Autenticación y autorización

Todos los endpoints nuevos requieren `Authorization: Bearer <JWT>`, una sesión administrativa vigente en Redis y el rol administrativo `1`. Una sesión inexistente o vencida responde `401`; un rol no autorizado responde `403`; una falla del almacén de sesiones responde `503` desde el middleware existente.

Las rutas de edición de clientes y registro de motocicletas también exigen ahora el rol administrativo porque generan actividad atribuida al actor real.

## Perfil, seguridad y avatar reutilizados

### `GET /api/settings/profile`

Devuelve los campos reales del usuario autenticado:

```json
{
  "id": 7,
  "name": "Admin",
  "lastName": "Prueba",
  "email": "admin@example.test",
  "phone": "+502 0000 0000",
  "role": { "id": 1, "name": "Administrador" },
  "registeredAt": "2026-01-10",
  "lastLoginAt": null,
  "avatarUrl": "/api/settings/avatar"
}
```

`lastLoginAt` permanece `null` hasta el primer inicio de sesión exitoso después de aplicar la migración.

### `PATCH /api/settings/profile`

Admite actualizaciones parciales de `name`, `lastName`, `email` y `phone`. El rol y las fechas son de solo lectura. Valida longitudes, formato del correo, teléfono y correo duplicado.

```json
{
  "lastName": "Prueba",
  "phone": "+502 0000 0000"
}
```

### Contraseña y avatar

- `PUT /api/settings/password`: exige `currentPassword` y `newPassword`; verifica la contraseña actual y conserva la política existente de no cerrar otras sesiones automáticamente.
- `GET|PUT|DELETE /api/settings/avatar`: consulta, reemplaza o elimina el avatar autenticado. El `PUT` recibe el binario PNG, JPEG o WebP, con límite de 2 MB.

## Resumen del perfil

### `GET /api/profile/overview`

Parámetros opcionales `from` y `to` en formato `YYYY-MM-DD`. Sin parámetros usa el mes actual en `America/Guatemala`. El intervalo máximo es de 366 días.

```json
{
  "profile": {
    "id": 7,
    "name": "Admin",
    "lastName": "Prueba",
    "email": "admin@example.test",
    "phone": null,
    "role": { "id": 1, "name": "Administrador" },
    "registeredAt": "2026-01-10T00:00:00.000Z",
    "lastLoginAt": "2026-10-29T14:20:00.000Z"
  },
  "stats": {
    "clientsRegistered": 2,
    "maintenancesRegistered": 3,
    "plateProcessesUpdated": 1
  },
  "recentActivity": [],
  "period": { "from": "2026-10-01", "to": "2026-10-29" },
  "activityAvailableFrom": "2026-10-29",
  "historicalAttributionAvailable": false
}
```

Los totales cuentan eventos del administrador autenticado dentro del período; no cuentan filas históricas de las tablas de negocio ni actividades de otros usuarios. `activityAvailableFrom` informa la primera fecha de actividad atribuible disponible para ese usuario y es `null` mientras aún no existan eventos. Cada mantenimiento registrado cuenta como una operación aunque tenga varios servicios asociados.

## Actividad paginada

### `GET /api/profile/activity`

Admite `page` (predeterminado `1`), `pageSize` (predeterminado `20`, máximo `50`), `from` y `to`.

```json
{
  "data": [
    {
      "id": 15,
      "type": "MAINTENANCE_CREATED",
      "entityType": "MAINTENANCE",
      "entityId": "42",
      "occurredAt": "2026-10-29T15:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 },
  "period": { "from": "2026-10-01", "to": "2026-10-29" }
}
```

Eventos implementados:

- `CLIENT_CREATED` y `CLIENT_UPDATED`;
- `MAINTENANCE_CREATED`;
- `PLATE_PROCESS_UPDATED`.

El evento se escribe dentro de la misma transacción que la operación de negocio correspondiente. Si la bitácora falla, esa transacción se revierte y la API no reporta éxito.

## Sesiones administrativas

Las sesiones continúan usando JWT más Redis y conservan el TTL original de cuatro horas. El índice `user-sessions:<userId>` evita búsquedas globales con `KEYS`. La actividad de la sesión se actualiza como máximo una vez por minuto mediante `KEEPTTL` y `XX`: no prolonga la expiración ni puede volver a crear una sesión eliminada durante una actualización concurrente.

Las nuevas sesiones guardan fecha de creación, última actividad, agente de usuario y una referencia pública aleatoria. Las sesiones antiguas que solo contienen `userId` y `email` siguen validándose; si son la sesión actual, aparecen con metadatos desconocidos y una referencia opaca derivada, nunca con el `sid` real.

### `GET /api/profile/sessions`

```json
{
  "sessions": [
    {
      "reference": "e143f4aa-1111-4444-8888-abcdefabcdef",
      "current": true,
      "createdAt": "2026-10-29T14:20:00.000Z",
      "lastActivityAt": "2026-10-29T14:25:00.000Z",
      "browser": "Safari",
      "operatingSystem": "macOS",
      "device": "Computadora"
    }
  ]
}
```

La identificación de navegador, sistema y tipo de dispositivo es orientativa y se obtiene del encabezado `User-Agent`; puede aparecer como `Desconocido`.

### `DELETE /api/profile/sessions/:reference`

Revoca otra sesión del mismo usuario. No acepta el `sid` interno, no permite revocar sesiones ajenas y responde `409` si se intenta cerrar la sesión actual por esta ruta.

### `DELETE /api/profile/sessions/others`

Cierra todas las demás sesiones del usuario autenticado y conserva la actual:

```json
{ "deleted": 2 }
```

El cambio de contraseña mantiene la política existente: no revoca automáticamente las demás sesiones. El frontend puede ofrecer posteriormente la acción separada de cerrar otras sesiones.

## Integración de eventos

La bitácora se agregó a las operaciones existentes:

- `POST /api/clients`;
- `PATCH /api/clients/:nit`;
- `POST /api/maintenance` y `POST /api/dashboard/maintenance`;
- creación de estados en `PROCESSING` durante el flujo autenticado de registro de motocicleta.
- `POST /api/motorcycles/:motorcycleId/process`, para agregar un estado existente a una motocicleta mediante una operación administrativa autenticada.

No se generaron eventos históricos y no se modificaron recordatorios, correos, chatbot ni Notificaciones.

Durante la verificación del contrato se corrigió `POST /api/maintenance` para persistir también `agencyId` y `scheduleId`, ambos obligatorios en el esquema real. Esta ruta registra un mantenimiento realizado; las citas de `MAINTENANCE_APPOINTMENT` permanecen separadas y no generan `MAINTENANCE_CREATED`.

## Integración posterior del frontend

1. Reutilizar `GET/PATCH /api/settings/profile`, contraseña y avatar para las pestañas de datos y seguridad.
2. Consumir `/api/profile/overview` para las tarjetas y cinco actividades recientes.
3. Consumir `/api/profile/activity` al solicitar el historial completo.
4. Consumir `/api/profile/sessions` y usar únicamente `reference` para cerrar sesiones.
5. Tratar fechas como ISO UTC y presentarlas en `America/Guatemala`.
6. Mostrar `No registrado` cuando `lastLoginAt`, teléfono o metadatos de una sesión sean `null`/desconocidos.
7. No mostrar agencia, estado de cuenta o nombres de usuario porque el esquema actual no los proporciona de forma verificable.

## Pruebas automatizadas

Las pruebas unitarias cubren períodos de Guatemala, validación de rangos, estadísticas por actor, paginación, ausencia de atribución histórica, sesiones simultáneas, referencia opaca, revocación conservando la sesión actual y compatibilidad con sesiones antiguas. Las pruebas existentes cubren JWT vencido, sesión ausente, fallo de Redis, contraseña actual, correo duplicado y validación de avatar.

## Verificación real en desarrollo

El 28 de octubre de 2026 se confirmó que MySQL correspondía a la instancia local de la Mac (`127.0.0.1`, host local) y a la base de desarrollo `mototec`. Antes de escribir se comprobó que `USER_ACTIVITY` y `USLastLoginAt` no existían. Se aplicó `20261029_create_profile_activity.sql` sin recrear tablas ni alterar registros anteriores.

La estructura resultante quedó formada por:

- `USERS.USLastLoginAt DATETIME(3) NULL`;
- `USER_ACTIVITY` con clave primaria `UAId`;
- índice `IX_UserActivity_User_Date (USId, UACreatedAt)`;
- índice `IX_UserActivity_User_Type_Date (USId, UAEventType, UACreatedAt)`;
- clave foránea hacia `USERS.USId`.

Se levantaron procesos independientes en los puertos 3199 y 3200 con recordatorios deshabilitados y el prefijo Redis exclusivo `preventive-bot:test:profile:20261028-run1:`. Se utilizaron dos administradores, dos clientes, una motocicleta, un mantenimiento realizado, una cita programada y un estado de trámite ficticios.

Las pruebas HTTP reales confirmaron:

- consulta y edición parcial del perfil, correo duplicado y rechazo de `roleId`;
- contraseña actual verificada y conservación de las demás sesiones;
- último acceso sin cambios ante login fallido y actualizado ante login exitoso;
- eventos correctos para alta/edición de cliente, mantenimiento realizado y trámite;
- ausencia de eventos para altas duplicadas, motocicleta inexistente y estado inexistente;
- una cita programada no incrementa `MAINTENANCE_CREATED`;
- estadísticas aisladas entre dos administradores;
- actividad reciente, paginación y rechazo de un período mayor de 366 días;
- sesiones propias, referencia opaca, aproximación de navegador/sistema, revocación real, rechazo de sesión revocada, aislamiento entre usuarios y cierre de otras sesiones conservando la actual;
- compatibilidad de una sesión antigua sin metadatos;
- actualización de actividad limitada a una vez por minuto y TTL no extendido;
- persistencia de cuatro eventos y del último acceso al consultar desde un segundo proceso del backend.

Durante la prueba se corrigieron dos problemas encontrados:

1. `POST /api/maintenance` no persistía agencia y horario aunque el esquema los exige; ahora valida y guarda `agencyId` y `scheduleId`.
2. Una escritura asíncrona de última actividad podía competir con el cierre de sesión. Redis ahora usa `XX` junto con `KEEPTTL`, de modo que no recrea una sesión eliminada.

Identificadores creados y eliminados de forma puntual: usuarios 15 y 16; clientes 10 y 11; motocicleta 8; mantenimiento 17; cita 7; trámite 3. La comprobación final confirmó cero cuentas/clientes de prueba, cero eventos asociados y cero claves bajo el prefijo Redis de prueba. Las estructuras de la migración se conservaron.

La suite automatizada y la verificación real son independientes: las pruebas unitarias no sustituyen las comprobaciones HTTP/MySQL/Redis descritas en esta sección.
