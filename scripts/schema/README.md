# Esquema MySQL de Preventive Bot

Estos archivos preparan una base MySQL vacía sin copiar datos operativos de Mototec.

## Orden de aplicación

1. `001_schema.sql`: crea las 20 tablas actuales y `SCHEMA_MIGRATIONS`.
2. `002_catalogs.sql`: carga únicamente los catálogos no personales confirmados en la base local.
3. `003_verify.sql`: ejecuta consultas de comprobación de solo lectura.

No se deben aplicar sobre la base local `mototec`. Primero se crea una base independiente y se confirma que está vacía.

## Versión y configuración

- MySQL 8.0.16 o posterior.
- Motor InnoDB.
- Juego de caracteres `utf8mb4`.
- Collation `utf8mb4_0900_ai_ci`.
- Zona horaria de la conexión del backend: `-06:00`.
- En Linux los nombres de tabla distinguen mayúsculas y minúsculas. Las tablas físicas `agencies`, `maintenance` y `schedules` se mantienen en minúsculas.
- `Inicio del trámite` es una etapa visual y no se inserta en `STATE_PLATE`; los otros seis estados del seguimiento sí son persistentes.
- Las motocicletas pendientes usan `MOPlate = NULL`. El índice único continúa protegiendo las placas reales.
- Serie y número de factura forman una clave única compuesta en instalaciones nuevas.

## Aplicación manual en una base independiente

Los valores entre `<...>` son marcadores; no deben escribirse literalmente ni guardarse en Git.

```bash
mysql --host=<HOST_SEGURO> --port=<PUERTO> --user=<USUARIO> -p \
  --execute="CREATE DATABASE preventive_bot_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"

mysql --host=<HOST_SEGURO> --port=<PUERTO> --user=<USUARIO> -p \
  preventive_bot_restore < scripts/schema/001_schema.sql

mysql --host=<HOST_SEGURO> --port=<PUERTO> --user=<USUARIO> -p \
  preventive_bot_restore < scripts/schema/002_catalogs.sql

mysql --host=<HOST_SEGURO> --port=<PUERTO> --user=<USUARIO> -p \
  preventive_bot_restore < scripts/schema/003_verify.sql
```

Usar `-p` sin incluir la contraseña evita dejarla en el historial de la terminal.

## Control de migraciones

`SCHEMA_MIGRATIONS` registra una fila por versión con:

- versión y checksum SHA-256 del archivo;
- descripción;
- estado `APPLYING`, `APPLIED` o `FAILED`;
- hora de inicio y finalización;
- mensaje de error sanitizado cuando corresponda.

Antes de ejecutar una migración, el futuro ejecutor debe:

1. adquirir un bloqueo MySQL con `GET_LOCK('preventive_bot_schema_migrations', 30)`;
2. rechazar versiones ya marcadas como `APPLIED`;
3. comparar el checksum almacenado con el archivo actual;
4. registrar `APPLYING` antes del primer DDL;
5. marcar `APPLIED` únicamente después de todas las verificaciones;
6. marcar `FAILED` si el proceso termina con error;
7. liberar el bloqueo con `RELEASE_LOCK`.

MySQL confirma implícitamente muchas sentencias DDL. Por ello, una migración fallida debe inspeccionarse antes de reintentarse; no debe asumirse un rollback automático.

Una instalación creada directamente desde el esquema base debe registrar una versión de línea base solo después de validar estructura y catálogos. Esta fase no inserta esa fila automáticamente.

Para una instalación nueva de staging, calcular el checksum conjunto después de aplicar y verificar ambos archivos:

```bash
(cat scripts/schema/001_schema.sql scripts/schema/002_catalogs.sql) | shasum -a 256
```

Luego registrar manualmente una versión de línea base con estado `APPLIED`, el checksum obtenido y `SMFinishedAt` establecido. El valor no se incluye fijo en este documento para que un cambio posterior de los archivos no deje un checksum obsoleto. No se deben aplicar las migraciones históricas sobre una base que ya fue creada desde este esquema final.
