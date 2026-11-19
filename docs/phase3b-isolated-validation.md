# Fase 3B: validación aislada de MySQL y Redis

Fecha: 13 de noviembre de 2026.

## Alcance y aislamiento

La validación se realizó con contenedores temporales conectados únicamente a la red Docker interna `pb3b-private`:

- MySQL 8.4.13 ARM64;
- Redis 7 Alpine;
- imagen `preventive-bot-backend:phase3b`, construida desde la rama `Shey`;
- un proceso de backend con workers deshabilitados;
- un proceso separado de worker habilitado solo durante la prueba controlada.

La red se creó con la propiedad `internal`. MySQL y Redis no publicaron puertos al host. El backend se comprobó mediante solicitudes ejecutadas desde el propio contenedor. Las credenciales temporales se guardaron únicamente bajo `/private/tmp`, fuera del repositorio, y se eliminaron al terminar.

No se conectó el entorno a `Mototec`, Upstash, SMTP real, OpenAI, SAT ni Declaraguate. La red interna impidió que el intento automático de verificación externa asociado al alta de una motocicleta alcanzara SAT; ese componente externo no se considera verificado.

## Instalación del esquema

Se ejecutaron, en orden, sobre una base vacía:

1. `scripts/schema/001_schema.sql`;
2. `scripts/schema/002_catalogs.sql`;
3. `scripts/schema/003_verify.sql`.

Resultados:

- 21 tablas InnoDB;
- 23 claves foráneas;
- `lower_case_table_names = 0`, equivalente al comportamiento sensible a mayúsculas de Linux;
- 6 estados persistentes de placas;
- 16 servicios;
- 19 horarios;
- 1 agencia;
- 8 tipos de notificación;
- `MOPlate` nullable;
- índice único compuesto de serie y número de factura;
- cero grupos de facturas duplicadas.

Después de validar estructura y catálogos se registró `baseline-20261113` en `SCHEMA_MIGRATIONS` con estado `APPLIED` y checksum SHA-256 de 64 caracteres calculado a partir de `001_schema.sql` y `002_catalogs.sql`. No se aplicaron migraciones históricas encima del esquema final.

## Datos ficticios

Los fixtures usaron exclusivamente identificadores `PB3B`, direcciones `example.invalid` y teléfonos no operativos. Incluyeron:

- un administrador con contraseña Argon2id;
- clientes creados por fixture y por API;
- motocicletas con placa y con `MOPlate = NULL`;
- facturas con ceros iniciales;
- historial de estados de placas;
- mantenimiento con dos servicios;
- citas futuras y vencidas;
- recordatorios pendientes y fallidos;
- una notificación interna;
- preferencias y actividad generadas durante las pruebas HTTP.

Los datos se eliminaron retirando exclusivamente la base, contenedores y volúmenes con prefijo `pb3b-`. No se usaron sentencias de limpieza contra una base habitual.

## Pruebas HTTP reales

Se completaron 33 verificaciones contra Express, MySQL y Redis reales del entorno aislado:

- rechazo de rutas administrativas sin autenticación;
- rechazo de contraseña incorrecta;
- login Argon2id;
- creación de JWT y sesión Redis;
- listado, creación y detalle de clientes;
- registro de motocicleta sin placa;
- actualización y consulta del trámite de placas;
- consulta exacta de factura con ceros iniciales;
- registro de mantenimiento con servicios y consulta de historial;
- creación de sesión temporal del cliente mediante factura;
- aislamiento de la motocicleta autorizada;
- consulta de disponibilidad;
- creación y listado de citas con servicios;
- rechazo de una reserva duplicada;
- bandeja y marcado de notificaciones;
- catálogo de ocho tipos de notificación;
- historial de recordatorios;
- resumen de perfil y actividad;
- valores predeterminados y actualización parcial de preferencias;
- cambio de contraseña y nuevo login;
- cierre y revocación de sesiones administrativas y de cliente;
- rate limiting del login administrativo.

La inspección directa posterior confirmó:

- un usuario con hash `$argon2id$`;
- dos motocicletas con placa nula después de la prueba;
- una factura `00000003` conservada como texto;
- cero facturas duplicadas;
- cero relaciones huérfanas en motocicletas, procesos y detalles de mantenimiento;
- cuatro eventos de actividad;
- una preferencia persistida;
- cuatro claves Redis con expiración, todas bajo el prefijo de Fase 3B.

## Healthchecks

- `/health/live`: HTTP 200.
- `/health/ready` con MySQL y Redis disponibles: HTTP 200.
- MySQL detenido: HTTP 503, `mysql=down`, `redis=up`.
- MySQL recuperado: HTTP 200.
- Redis detenido: HTTP 503, `mysql=up`, `redis=down`.
- Redis recuperado: HTTP 200.

## Workers

El backend principal registró `Workers periódicos deshabilitados` con `REMINDER_WORKER_ENABLED=false`.

En un worker separado y conectado únicamente al entorno aislado:

- una cita vencida pasó de `PROGRAMADO` a `NO_ASISTIO`;
- se generó el aviso `APPOINTMENT_NO_SHOW`;
- un recordatorio vencido intentó usar el host inexistente `pb3b-mail-sink` y quedó en `ERROR` después de tres intentos;
- se generaron avisos de mantenimiento próximo, trámite sin avance y correo fallido;
- una ejecución adicional no aumentó el total de notificaciones;
- no hubo claves de deduplicación repetidas;
- el worker recibió `SIGTERM` y registró `Worker detenido`.

La función `periodicTask` evita que una tarea se solape consigo misma dentro de un único proceso. No existe actualmente un bloqueo distribuido entre dos procesos o réplicas diferentes. En un despliegue con más de una réplica de worker, dos procesos podrían seleccionar el mismo recordatorio pendiente antes de que uno actualice su estado. Esta limitación no se corrigió porque requiere una decisión de arquitectura y autorización para modificar la lógica de negocio.

## Compatibilidad con React

Se compararon los endpoints y tipos usados por el frontend con las respuestas verificadas:

- las placas admiten `string | null` en los tipos de motocicletas, mantenimiento y chatbot;
- el portal usa la sesión temporal `Client` y no una cuenta administrativa;
- el seguimiento consume `plateTracking` generado por el backend;
- mantenimientos, citas, servicios, notificaciones, perfil y configuración conservaron sus contratos;
- `pnpm lint` y `pnpm build` del frontend terminaron correctamente.

La pantalla administrativa de registro de motocicletas todavía exige una placa. Es una limitación de interfaz ya conocida y no se modificó en esta fase.

## Comprobaciones técnicas

Backend:

- `pnpm typecheck`: aprobado;
- `pnpm test`: 155 aprobadas, 0 fallidas;
- `pnpm build`: aprobado;
- `git diff --check`: aprobado;
- imagen Docker ARM64: construida correctamente.

Frontend, sin modificaciones:

- `pnpm lint`: aprobado;
- `pnpm build`: aprobado.

## Pendientes antes de producción

1. Definir si Railway ejecutará una sola réplica de worker o implementar un bloqueo distribuido/idempotencia de entrega antes de admitir varias réplicas.
2. Probar SMTP con un buzón técnico controlado en una fase autorizada; en esta prueba no salió ningún correo.
3. Probar SAT y Declaraguate en un entorno expresamente autorizado. En Fase 3B la red interna bloqueó el acceso.
4. Corregir posteriormente el formulario administrativo que obliga a ingresar placa.

## Limpieza

Después de recopilar los resultados se eliminaron únicamente:

- `pb3b-backend`, `pb3b-worker`, `pb3b-mysql`, `pb3b-redis`;
- red `pb3b-private`;
- volúmenes `pb3b-mysql-data` y `pb3b-redis-data`;
- variables, fixtures y resultados temporales bajo `/private/tmp`.

La imagen `preventive-bot-backend:phase3b` también se retiró al finalizar. No se eliminaron imágenes base ni recursos Docker ajenos.
