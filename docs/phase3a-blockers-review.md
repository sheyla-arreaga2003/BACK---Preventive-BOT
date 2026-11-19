# Revisión controlada de bloqueos de Fase 3A

Fecha: 13 de noviembre de 2026.

La base local `Mototec` se inspeccionó exclusivamente mediante consultas de lectura y agregados. No se ejecutaron migraciones ni sentencias de escritura sobre ella.

## Estados del trámite de placas

La correspondencia se confirmó en el backend y en el frontend:

- `Inicio del trámite` es una representación visual calculada. No pertenece a `STATE_PLATE`.
- `Verificación de NIT` y `Solicitud primeras placas` son estados persistentes existentes. El alta actual los referencia mediante los identificadores confirmados 1 y 2.
- `Pago IPRIMA registrado`, `Documentos presentados y contraseña de pago recibida`, `Pago final registrado y gestión finalizada` y `Placas recibidas en Mototec` son estados persistentes requeridos. El seguimiento los obtiene de `PROCESSING → STATE_PLATE`; además, las notificaciones comparan explícitamente el estado final.
- El frontend no mantiene un catálogo paralelo: renderiza las etapas y porcentajes devueltos por el backend.

La etiqueta más larga tiene 52 caracteres, por lo que `VARCHAR(25)` no es suficiente. El esquema nuevo usa `VARCHAR(100)`. Los cuatro estados faltantes se insertan sin identificadores explícitos; MySQL los asigna. No se inventaron identificadores.

La migración `20261113_prepare_mysql_production.sql` amplía la columna y completa el catálogo. Su rollback se niega a retirar los estados si ya están referenciados por `PROCESSING`.

## Serie y número de factura

La consulta local confirmó:

- 0 grupos duplicados exactos;
- 0 grupos duplicados después de eliminar espacios exteriores;
- 0 valores con espacios exteriores;
- longitud máxima observada: 7 caracteres para serie y 8 para número.

El portal conserva ambos valores como texto y mantiene ceros iniciales. El servicio público devuelve `ambiguous` si una base heredada contiene más de una coincidencia, por lo que la respuesta defensiva se conserva.

Una factura identifica conceptualmente una motocicleta. El esquema nuevo incorpora el índice único compuesto `UQ_Motorcycles_Invoice`. La migración solo lo agrega después de comprobar que no existen duplicados y se detiene sin alterar el esquema cuando los encuentra.

## Fechas y kilometrajes almacenados como texto

Columnas revisadas:

- fechas: `PROCESSING.PRFirstDate`, `PROCESSING.PRDateUpdate`, `maintenance.MANextDate`;
- kilometrajes: `MOTORCYCLES.MOMiles`, `maintenance.MAMiles`, `maintenance.MANextMiles`, `MAINTENANCE_APPOINTMENT.MAPMileage`;
- recomendaciones de catálogo: `SERVICES.SEMilesRecom` y `SERVICES.SETimeRecom`, que son texto descriptivo y no deben convertirse automáticamente.

En los registros actuales, todas las fechas no vacías usan `YYYY-MM-DD` y todos los kilometrajes no vacíos contienen únicamente dígitos. Sin embargo, la ruta administrativa de mantenimiento todavía acepta algunos de esos campos como texto por longitud, mientras que las citas del cliente sí exigen dígitos y fechas válidas.

La conversión a `DATE` o a un tipo numérico no es indispensable para el primer despliegue porque:

1. no existen valores locales incompatibles;
2. cambiar tipos requiere primero unificar validaciones administrativas y límites numéricos;
3. varias respuestas públicas y administrativas siguen tipadas como cadenas.

Por ello no se preparó una conversión de tipos en esta fase. Debe tratarse como una migración posterior con preflight, respaldo y pruebas de compatibilidad.

## Motocicletas sin placa

El backend, dashboard, chatbot y módulo de placas ya definen una placa pendiente como `MOPlate IS NULL OR TRIM(MOPlate) = ''`. El esquema anterior (`NOT NULL UNIQUE`) contradecía esa regla y solo permitía una cadena vacía, impidiendo representar varias motocicletas pendientes.

La representación canónica para instalaciones nuevas será `NULL`:

- `MOPlate` permanece único para placas reales, pero admite varios `NULL` en MySQL;
- el backend normaliza vacío y espacios a `NULL` al registrar;
- las lecturas heredadas continúan aceptando vacío o espacios para no romper compatibilidad.

La migración solo vuelve nullable la columna; no reescribe registros existentes. El rollback se detiene si ya existen motocicletas con placa `NULL`.

La pantalla administrativa actual todavía marca el campo Placa como obligatorio. No se modificó el frontend porque quedó fuera del alcance autorizado. El backend y el esquema quedan preparados, pero permitir el alta sin placa desde esa pantalla requiere una corrección de frontend posterior.

## Compatibilidad Linux adicional

Se encontraron referencias en minúscula a tablas físicas en mayúscula dentro del servicio heredado de base de datos: `motorcycles`, `customer` y `reminder`. Se normalizaron a `MOTORCYCLES`, `CUSTOMER` y `REMINDER`. Los nombres físicos realmente minúsculos (`agencies`, `maintenance`, `schedules`) se conservaron.

## Archivos de instalación

- `001_schema.sql`: `STState VARCHAR(100)`, `MOPlate NULL`, índice único de factura.
- `002_catalogs.sql`: seis estados persistentes; `Inicio del trámite` no se inserta.
- `003_verify.sql`: verifica estados, duplicados de factura y definiciones de las columnas corregidas.

## Migración preparada

- Aplicación: `scripts/migrations/20261113_prepare_mysql_production.sql`.
- Reversión: `scripts/migrations/rollback/20261113_restore_preproduction_schema.sql`.

No se ejecutaron sobre `Mototec`. Antes de usarlas en otro entorno se debe crear un respaldo, registrar el checksum y ejecutar primero las consultas de preflight.
