# Fase 3A: preparación de MySQL para producción

Fecha de revisión: 13 de noviembre de 2026.

Esta fase se realizó con consultas de metadatos y catálogos de solo lectura sobre la base local `Mototec`. No se ejecutaron migraciones ni sentencias de escritura sobre ella.

## 1. Entorno inspeccionado

- Servidor: MySQL Community Server 9.7.1 local.
- Base: `Mototec`.
- Motor de las 20 tablas: InnoDB.
- Juego de caracteres: `utf8mb4`.
- Collation: `utf8mb4_0900_ai_ci`.
- `lower_case_table_names`: `2` en macOS.
- Zona horaria del servidor: `CST`; la conexión del backend debe fijar `DB_TIMEZONE=-06:00`.
- Event Scheduler: activo, pero la base no contiene eventos programados.
- Triggers: ninguno.
- Procedimientos almacenados: ninguno.
- Funciones almacenadas: ninguna.
- Vistas: ninguna.

El esquema generado requiere MySQL 8.0.16 o posterior. Fue comparado con MySQL local 9.7.1 y aplicado correctamente en un MySQL Linux 8.4.13 aislado con `lower_case_table_names=0`.

## 2. Inventario del esquema

El detalle exacto de las 145 columnas, tipos, valores predeterminados, índices y restricciones se conserva en `scripts/schema/001_schema.sql`.

| Tabla física | Propósito | Clave primaria | Relaciones principales |
| --- | --- | --- | --- |
| `ROL` | Roles administrativos | `ROIdRol` | — |
| `USERS` | Cuentas administrativas | `USId` | `ROIdRol → ROL` |
| `USER_PREFERENCES` | Preferencias por administrador | `USId` | `USId → USERS` con cascada |
| `USER_MEDIA` | Avatar y fondo personalizados | `UMId` | `USId → USERS` con cascada |
| `USER_ACTIVITY` | Actividad administrativa | `UAId` | `USId → USERS` con restricción |
| `CUSTOMER` | Clientes | `CUIdCustomer` | — |
| `MOTORCYCLES` | Motocicletas y datos de factura | `MOIdMoto` | `CUIdCustomer → CUSTOMER` |
| `STATE_PLATE` | Catálogo de estados de placas | `STIdState` | — |
| `PROCESSING` | Historial del trámite de placas | `PRIdProcess` | motocicleta y estado |
| `agencies` | Agencias | `AGIdAgencie` | — |
| `schedules` | Horarios disponibles | `SCIdSchedule` | — |
| `SERVICES` | Catálogo de servicios | `SEIdService` | — |
| `maintenance` | Servicios de mantenimiento realizados | `MAMaintenance` | agencia, horario, motocicleta y usuario |
| `DETAIL_MAINTENANCE` | Servicios asociados a un mantenimiento realizado | `DMIdDetail` | mantenimiento y servicio |
| `MAINTENANCE_APPOINTMENT` | Citas solicitadas | `MAPIdAppointment` | motocicleta, agencia y horario |
| `MAINTENANCE_APPOINTMENT_SERVICE` | Servicios solicitados en una cita | compuesta | cita y servicio |
| `REMINDER` | Recordatorios automáticos y personalizados | `REIdReminder` | mantenimiento, cita, cliente y usuario |
| `NOTIFICATION_SETTING` | Tipos de aviso administrativo | `NSType` | — |
| `NOTIFICATION` | Bandeja de avisos administrativos | `NOIdNotification` | tipo de aviso |
| `SPARE_PARTS` | Catálogo de repuestos aún sin datos | `SPId` | — |

Además del esquema actual, `001_schema.sql` crea `SCHEMA_MIGRATIONS` para el control futuro de versiones. Esta tabla no fue creada en `Mototec` durante la fase.

### Índices y reglas relevantes

- Correo y DPI de cliente son únicos.
- Correo administrativo es único.
- Hora de `schedules` es única.
- `maintenance` impide duplicar agencia, fecha y horario.
- Las citas impiden duplicar únicamente un horario activo mediante la columna virtual `MAPActive`; una cita no programada libera el horario.
- Los servicios de una cita tienen clave compuesta para evitar duplicados.
- Los avisos usan `NODedupeKey` único.
- Los recordatorios personalizados usan `RERequestKey` único.
- Existen índices para bandeja, historial, actividad y recordatorios pendientes.
- Se encontraron 23 componentes de claves foráneas.

## 3. Catálogos iniciales

`scripts/schema/002_catalogs.sql` contiene exclusivamente datos no personales consultados en la base local:

- 1 rol administrativo.
- 6 estados persistentes de placas en una instalación nueva.
- 1 agencia activa.
- 19 horarios activos, de 08:00 a 17:00 en intervalos de 30 minutos.
- 16 servicios activos.
- 8 configuraciones de avisos.

`SPARE_PARTS` está vacío y no se agrega información inventada.

### Clasificación

- **Estructurales indispensables:** `ROL`, `STATE_PLATE`, `agencies`, `schedules`, `SERVICES` y `NOTIFICATION_SETTING`.
- **Configuración manual posterior:** creación segura del primer administrador, revisión de agencia/horarios, preferencias de avisos y credenciales externas.
- **Datos operativos que no se incluyen:** usuarios, clientes, motocicletas, trámites, mantenimientos, citas, recordatorios, avisos, actividad e imágenes.

### Correspondencia confirmada de estados de placas

La base local contiene `Verificación de NIT` y `Solicitud primeras placas`. El código requiere además:

- `Pago IPRIMA registrado`;
- `Documentos presentados y contraseña de pago recibida`;
- `Pago final registrado y gestión finalizada`;
- `Placas recibidas en Mototec`.

`Inicio del trámite` es únicamente la etapa visual de 0 % y no se almacena. Los otros seis nombres son estados persistentes porque el seguimiento los relaciona con filas de `PROCESSING`, y las notificaciones consultan explícitamente el estado final. El esquema nuevo amplía `STState` a `VARCHAR(100)`. Solo se conservan los identificadores confirmados 1 y 2; MySQL asigna los identificadores de los cuatro estados restantes.

## 4. Revisión de migraciones

| Migración | Reflejada localmente | Repetible | Observación |
| --- | --- | --- | --- |
| `20261008_unique_maintenance_slot.sql` | Sí | No | Requiere comprobar duplicados antes del `ALTER` y falla si el índice ya existe. |
| `20261016_create_maintenance_appointments.sql` | Sí, más cambios posteriores | Parcial | `CREATE TABLE IF NOT EXISTS`; su ENUM inicial fue ampliado después. |
| `20261016_add_appointment_mileage.sql` | Sí | No | Falla si la columna ya existe. |
| `20261016_create_maintenance_appointment_services.sql` | Sí | Parcial | La tabla usa `IF NOT EXISTS`; no valida diferencias internas si ya existe. |
| `20261027_create_user_settings.sql` | Sí | Parcial | Tablas protegidas con `IF NOT EXISTS`; ya incluye los ocho acentos. |
| `20261028_expand_user_preference_accent_colors.sql` | Sí | No | Redundante en instalaciones nuevas porque la migración anterior ya contiene los ocho valores. |
| `20261028_notifications_module.sql` | Sí | No | Contiene varios `ALTER`, tablas e inserciones no idempotentes. Debe aplicarse una sola vez en orden. |
| `20261029_create_profile_activity.sql` | Sí | Mayormente | Comprueba la columna y usa `IF NOT EXISTS` para la tabla. |
| `20261105_appointment_status_es.sql` | Estado final reflejado | No | El comentario presupone estados ingleses, pero la migración de notificaciones actual ya usa estados españoles. No debe ejecutarse sobre el esquema final. |
| `20261111_personalized_reminders.sql` | Sí | No | Agrega columnas, índices y claves sin comprobaciones previas. |
| `20261112_reminder_delivery_history.sql` | Sí | No | Agrega columna e índices sin comprobaciones previas. |
| `rollback/20261029_drop_profile_activity.sql` | No corresponde | Destructiva | Solo para rollback explícito; no forma parte de la instalación. |

No existe una migración histórica para crear las tablas originales del proyecto. Por ello, una base nueva debe comenzar con `001_schema.sql`, no intentando reproducir únicamente la carpeta de migraciones.

## 5. Compatibilidad Linux

La base local de macOS conserva tres tablas físicas en minúsculas: `agencies`, `maintenance` y `schedules`. macOS las resolvía aunque varias consultas usaran mayúsculas porque `lower_case_table_names=2`. En Linux normalmente se distinguen los nombres por capitalización.

Las consultas del backend fueron normalizadas para usar exactamente los nombres físicos. Los textos de dominio como `MAINTENANCE_CREATED` y la entidad `MAINTENANCE` no fueron cambiados porque no son identificadores SQL.

No deben renombrarse las tablas locales. El esquema base también las crea en minúsculas.

## 6. Diferencias y riesgos del modelo actual

- `PROCESSING.PRFirstDate` y `PRDateUpdate` almacenan fechas en `VARCHAR(20)`. Los valores actuales son ISO, pero una futura conversión requiere unificar primero las validaciones.
- `maintenance.MANextDate` y varias lecturas de kilometraje siguen siendo texto. Los valores actuales son compatibles, pero las rutas administrativas aún admiten cadenas por longitud.
- El frontend administrativo todavía exige una placa al registrar, aunque el esquema nuevo y el backend ya admiten `NULL` como placa pendiente.
- Las migraciones históricas no tienen checksums ni registro de aplicación.
- La base local usa MySQL 9.7.1; producción debe probarse contra la versión concreta elegida en Railway antes de importar datos.

Estos puntos no se modificaron porque requieren una decisión de compatibilidad o de negocio.

## 7. Respaldo y restauración segura

### Respaldo local

Instalar un cliente MySQL compatible y crear una carpeta fuera de Git. La contraseña se solicita de forma interactiva:

```bash
mkdir -p "$HOME/preventive-bot-backups"

mysqldump \
  --host=127.0.0.1 \
  --port=3306 \
  --user=<USUARIO_LOCAL> \
  -p \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --set-gtid-purged=OFF \
  --default-character-set=utf8mb4 \
  --no-tablespaces \
  Mototec > "$HOME/preventive-bot-backups/mototec-$(date +%Y%m%d-%H%M%S).sql"
```

Después se calcula un checksum y se comprueba que el archivo no esté vacío:

```bash
test -s "$HOME/preventive-bot-backups/<ARCHIVO>.sql"
shasum -a 256 "$HOME/preventive-bot-backups/<ARCHIVO>.sql" \
  > "$HOME/preventive-bot-backups/<ARCHIVO>.sql.sha256"
```

El respaldo contiene información sensible y no debe subirse a Git ni compartirse por canales inseguros.

### Restauración de ensayo

1. Preservar la base original y detener cualquier proceso que pudiera escribir en la base de ensayo.
2. Crear una base distinta, por ejemplo `mototec_restore_test`.
3. Verificar el checksum del respaldo.
4. Restaurar únicamente en la base distinta.
5. ejecutar `003_verify.sql`.
6. comparar conteos, claves foráneas e índices.
7. apuntar un backend aislado a la restauración y ejecutar smoke tests sin correos ni workers.
8. eliminar la base de ensayo solo después de documentar el resultado y confirmar el nombre exacto.

Nunca se debe restaurar directamente encima de `Mototec` como primera prueba.

## 8. Preparación posterior en Railway

Railway expone para MySQL `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE` y `MYSQL_URL`. El backend seguirá utilizando su contrato `DB_*` mediante referencias de variables:

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_SSL_MODE`
- `DB_TIMEZONE`
- `DB_CONNECTION_LIMIT`
- `DB_CONNECT_TIMEOUT_MS`

Recomendaciones para la Fase 3B:

1. mantener MySQL privado y referenciar sus variables desde el backend;
2. evitar valores de conexión escritos directamente;
3. usar `DB_TIMEZONE=-06:00`;
4. comenzar con un límite conservador y recordar que cada réplica del backend crea su propio pool;
5. confirmar si el endpoint privado ofrece TLS antes de seleccionar `DB_SSL_MODE`;
6. ejecutar importaciones o migraciones desde un proceso con acceso a la red privada, no durante la compilación de la imagen;
7. activar respaldos y probar una restauración independiente;
8. considerar recuperación a un punto en el tiempo y alta disponibilidad según el nivel de servicio requerido;
9. no habilitar acceso público permanente a MySQL.

Railway documenta que MySQL se despliega privado por defecto y que el acceso público crea un proxy TCP. También ofrece respaldos y recuperación a un punto en el tiempo. Referencias:

- https://docs.railway.com/databases/mysql
- https://docs.railway.com/overview/best-practices
- https://docs.railway.com/networking/private-networking/how-it-works

## 9. Verificación antes de producción

- Aplicar esquema y catálogos en un MySQL Linux vacío.
- Confirmar 21 tablas contando `SCHEMA_MIGRATIONS`.
- Confirmar InnoDB, `utf8mb4` y la collation.
- Confirmar claves foráneas e índices con `003_verify.sql`.
- Confirmar que no existan usuarios, clientes ni datos operativos en los archivos de instalación.
- Ejecutar build, typecheck y pruebas automatizadas.
- Ejecutar smoke tests del backend con workers y correos deshabilitados.
- Verificar `/health/live` y `/health/ready`.
- Probar login con una cuenta de prueba creada de forma segura.
- Probar portal por factura con datos ficticios solo en el entorno de ensayo.
- Probar clientes, motocicletas, placas, citas, mantenimientos, recordatorios y configuraciones.
- Confirmar que la migración de preparación esté registrada antes de importar datos heredados.

## 10. Confirmación de no modificación

Durante esta fase no se ejecutaron `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP`, `TRUNCATE` ni migraciones sobre `Mototec`. Las únicas consultas realizadas sobre la base local fueron de lectura y metadatos (`SELECT` y `SHOW CREATE TABLE`).
