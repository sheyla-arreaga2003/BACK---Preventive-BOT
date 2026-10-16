# Pruebas de carga con k6 — Preventive Bot

## Alcance

Estas pruebas consultan únicamente datos de una base de pruebas:

- `GET /api/clients?page=1&pageSize=20`
- `GET /api/motorcycles/pendingPlates?page=1&pageSize=20`

El inicio de sesión usa `POST /api/auth/login` y al terminar se llama a `POST /api/auth/logout`. No se ejecutan operaciones de escritura de clientes o motocicletas ni llamadas a OpenAI, SAT o Declaraguate.

La ruta de clientes está protegida por JWT y una sesión almacenada en Redis. La implementación actual de `pendingPlates` no contiene middleware de autenticación; la prueba envía el JWT igualmente y valida periódicamente la sesión mediante la ruta protegida de clientes. Esta diferencia debe documentarse y no se modificó para ejecutar las pruebas.

## Entorno revisado

Fecha de preparación: **9 de octubre de 2026**.

| Componente | Valor comprobado |
| --- | --- |
| Equipo de prueba y backend | La misma MacBook Air |
| macOS | 27.0.1 |
| Arquitectura | Apple Silicon (`arm64`) |
| Node.js | 24.18.0 |
| pnpm | 11.17.0 |
| Backend | `Back-Preventive-Bot` 1.0.0, rama `Shey`, commit base `ce66bd9` |
| k6 | 2.3.0, binario oficial ARM64 en `~/.local/bin/k6` |

Los resultados dependen del hardware, procesos en segundo plano, volumen de datos y configuración local. Esta ejecución no representa un entorno distribuido ni de producción.

## 1. Verificar k6

El binario oficial ARM64 está instalado en la carpeta del usuario. Verifique:

```bash
~/.local/bin/k6 version
```

No se utilizó Homebrew ni Docker.

## 2. Preparar el entorno aislado

No use el `.env` habitual. El aprovisionamiento creó en la raíz del backend los archivos ignorados por Git `.env.k6.local` y `.env.k6.credentials.local`, ambos con permisos `600`. No muestre ni confirme sus valores en consola.

El entorno quedó aislado con:

```dotenv
PORT=3100
JWT_SECRET=<secreto_exclusivo_de_pruebas>
REDIS_URL=<servicio_local_existente>
REDIS_KEY_PREFIX=preventive-bot:test:k6:

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=<usuario_local_configurado>
DB_PASSWORD=<contraseña_de_pruebas>
DB_NAME=preventive_bot_k6_test

OPENAI_API_KEY=<valor_requerido_por_el_arranque_pero_no_usado_en_estas_pruebas>
OPENAI_MODEL=<modelo_configurado_pero_no_usado>
CHATBOT_RAG_ENABLED=false
REMINDER_WORKER_ENABLED=false
```

Configuración comprobada:

1. MySQL: `preventive_bot_k6_test`, con 24 clientes y 24 motocicletas ficticias. No se modificó `Mototec`.
2. Redis: el mismo servicio local, aislado por `preventive-bot:test:k6:`. Las sesiones, límites y estado conversacional pasan por `redisKey()`.
3. Correo: el procesador automático queda desactivado explícitamente mediante `REMINDER_WORKER_ENABLED=false`; no depende de que la tabla esté vacía.
4. OpenAI/RAG: desactivado para este flujo. Las rutas de k6 no invocan el chatbot.
5. SAT y Declaraguate: solo se alcanzan desde el registro de motocicletas; las pruebas k6 usan exclusivamente rutas GET de consulta.

Inicie el backend cargando explícitamente el archivo aislado:

```bash
cd ~/Desktop/Back-Preventive-Bot
node --env-file=.env.k6.local --import tsx src/app.ts
```

La terminal debe confirmar conexión a MySQL y que el servidor escucha en el puerto configurado. No continúe si el archivo apunta a una base distinta de la base ficticia acordada.

## 3. Cargar credenciales sin dejarlas en el historial

Las credenciales ficticias se guardaron en `.env.k6.credentials.local`, ignorado por Git y con permisos `600`. El ejecutor las carga sin incluir sus valores en el historial:

```bash
cd ~/Desktop/Back-Preventive-Bot
./load-tests/k6/run-clients-smoke.sh
```

Las credenciales no se guardan en Git ni en los archivos de resultados. No las escriba directamente en el comando para evitar que queden en el historial de la terminal.

Para una sesión manual, sin imprimir valores:

```bash
set -a
source .env.k6.credentials.local
set +a
export BASE_URL=http://127.0.0.1:3100
export K6_PAGE=1
export K6_PAGE_SIZE=20
export K6_PAUSE_SECONDS=1
export K6_SESSION_CHECK_EVERY=30
```

## 4. Ejecutar primero la comprobación de un usuario

La primera ejecución obligatoria es la consulta de clientes:

```bash
~/.local/bin/k6 run \
  -e BASE_URL="${BASE_URL:-http://127.0.0.1:3100}" \
  -e K6_TEST_EMAIL="$K6_TEST_EMAIL" \
  -e K6_TEST_PASSWORD="$K6_TEST_PASSWORD" \
  load-tests/k6/clients.smoke.js
```

Solo continúe si devuelve HTTP 200, la sesión sigue válida y la respuesta contiene `data` y `pagination` con la estructura esperada. Una respuesta 401, 403, 429 o 500 es un fallo, aunque k6 termine de ejecutarse.

Después compruebe placas pendientes:

```bash
~/.local/bin/k6 run \
  -e BASE_URL="${BASE_URL:-http://127.0.0.1:3100}" \
  -e K6_TEST_EMAIL="$K6_TEST_EMAIL" \
  -e K6_TEST_PASSWORD="$K6_TEST_PASSWORD" \
  load-tests/k6/pending-plates.smoke.js
```

## 5. Ejecutar las pruebas graduales

Únicamente después de aprobar las dos comprobaciones anteriores:

```bash
./load-tests/k6/run-clients-load.sh
```

El ejecutor carga las credenciales desde `.env.k6.credentials.local` y usa una pausa de 1 segundo entre consultas. Puede cambiarse temporalmente con `K6_PAUSE_SECONDS`, sin editar el script. Cada corrida usa un nombre con fecha, hora y proceso (`clients-load-<identificador>.json`), por lo que no sobrescribe resultados anteriores.

```bash
k6 run \
  -e BASE_URL="${BASE_URL:-http://127.0.0.1:3000}" \
  -e K6_TEST_EMAIL="$K6_TEST_EMAIL" \
  -e K6_TEST_PASSWORD="$K6_TEST_PASSWORD" \
  -e K6_PAUSE_SECONDS=1 \
  load-tests/k6/pending-plates.load.js
```

Cada prueba gradual dura aproximadamente **6 minutos y 10 segundos**:

| Fase | Duración | Usuarios virtuales |
| --- | ---: | ---: |
| Entrada inicial | 10 s | 0 → 1 |
| Nivel 1 | 1 min | 1 |
| Transición | 30 s | 1 → 5 |
| Nivel 2 | 1 min | 5 |
| Transición | 30 s | 5 → 10 |
| Nivel 3 | 1 min | 10 |
| Transición | 30 s | 10 → 20 |
| Nivel 4 | 1 min | 20 |
| Salida | 30 s | 20 → 0 |

Cada usuario espera **1 segundo** después de cada consulta. Puede cambiarse con `K6_PAUSE_SECONDS`, pero debe registrarse el valor usado al documentar una ejecución.

### Prueba ampliada de clientes hasta 50 usuarios

Esta prueba es independiente de la carga gradual original y dura **8 minutos**. Mantiene 1 usuario durante 30 segundos; sube a 10, 20 y 30 usuarios con transiciones de 30 segundos y niveles de 1 minuto; sube a 50 usuarios en 30 segundos, mantiene 50 durante 2 minutos y desciende a 0 en 30 segundos.

```bash
./load-tests/k6/run-clients-50-load.sh
```

El escenario usa `ramping-vus`, `gracefulRampDown` de 10 segundos y una pausa predeterminada de 1 segundo. El reporte incluye métricas globales y un bloque separado para los 2 minutos estables con 50 usuarios. Cada ejecución se guarda como `clients-load-50vus-<fecha-hora>-<proceso>.json` y no reemplaza resultados anteriores.

En la prueba de placas pendientes, cada usuario comprueba periódicamente la sesión mediante la ruta protegida después de 30 iteraciones por defecto. Estas comprobaciones no se incluyen en las métricas personalizadas del endpoint de placas.

## 6. Resultados

Los reportes se guardan en `load-tests/k6/results/`:

- `clients-smoke-summary.json`
- `pending-plates-smoke-summary.json`
- `clients-load-summary.json`
- `pending-plates-load-summary.json`

Los JSON contienen por endpoint:

- Total de solicitudes.
- Solicitudes por segundo.
- Porcentaje de respuestas HTTP erróneas.
- Tiempo promedio, mediana, percentil 95 y máximo.
- Comprobaciones de contenido aprobadas y fallidas.
- Cantidad de respuestas HTTP 429.

La carpeta de resultados está ignorada por Git para evitar subir salidas accidentales. Los reportes no contienen contraseñas, tokens ni cuerpos completos de respuesta.

## Interpretación

Los niveles son exploratorios. No se han definido objetivos de tiempo, capacidad o porcentaje de error para afirmar que el rendimiento sea suficiente. Reporte las mediciones observadas y cualquier error; no considere aprobada una prueba únicamente porque el proceso de k6 finalizó.

El listado de clientes y las placas pendientes no tienen un limitador HTTP explícito en el código actual. El contador de 429 se conserva para detectar rechazos introducidos por infraestructura o cambios posteriores.
