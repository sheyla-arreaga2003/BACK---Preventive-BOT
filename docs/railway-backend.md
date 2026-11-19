# Preparación del backend para Railway

Este documento corresponde a la Fase 4A. Describe una configuración de staging, pero no crea servicios, no despliega y no ejecuta SQL.

## Arquitectura recomendada

Usar dos servicios persistentes creados desde el mismo repositorio y el mismo `Dockerfile`:

| Servicio | Réplicas | Comando | Dominio | Healthcheck |
| --- | ---: | --- | --- | --- |
| `preventive-bot-http-staging` | 1 | `node --enable-source-maps dist/server.js` | Público | `/health/ready`, 120 s |
| `preventive-bot-worker-staging` | 1 | `node --enable-source-maps dist/worker.js` | Ninguno | Ninguno |

El servicio HTTP debe usar `REMINDER_WORKER_ENABLED=false`. El worker debe permanecer inicialmente con `REMINDER_WORKER_ENABLED=false`; después de validar MySQL, Redis y las integraciones deshabilitadas, se puede cambiar únicamente el worker a `true`.

El comando del worker debe ser Node directo. Así `SIGTERM` y `SIGINT` llegan al proceso que implementa el cierre controlado. No se debe anteponer `pnpm`, `sh -c`, `npm` ni otro supervisor.

### Configuración compartida de Railway

El `railway.json` raíz conserva solo la construcción con el `Dockerfile`. No contiene `deploy.healthcheckPath` ni comando de arranque porque el mismo archivo se aplicaría también al worker. El `HEALTHCHECK` de Docker también se eliminó por la misma razón.

Para servicios nuevos, configurar arranque, réplicas, dominio y healthcheck en cada servicio de Railway. Railway anunció la retirada de Config as Code (`railway.json`/`railway.toml`) para servicios nuevos y su fin de soporte para servicios existentes el 1 de diciembre de 2026; por eso no se preparan dos archivos de despliegue que pronto quedarían obsoletos.

## Construcción y ejecución

- Instalación: `pnpm install --frozen-lockfile`
- Tipos: `pnpm typecheck`
- Pruebas: `pnpm test`
- Compilación: `pnpm build`
- HTTP compilado: `node --enable-source-maps dist/server.js`
- Worker compilado: `node --enable-source-maps dist/worker.js`

La imagen usa Node.js 22, pnpm 10.18.3 y Chromium Headless Shell instalado por Playwright. Se ejecuta como el usuario no privilegiado `node`.

## Variables por servicio

No copiar `.env` de desarrollo. Los secretos deben crearse manualmente o referenciarse desde variables compartidas de Railway.

### Obligatorias en HTTP y worker

| Variable | Origen | Observación de staging |
| --- | --- | --- |
| `NODE_ENV` | Manual | `production`; staging y producción usan secretos distintos. |
| `JWT_SECRET` | Secreto manual | Largo y aleatorio; distinto de desarrollo y producción. Aunque el worker no emite sesiones, el módulo de entorno lo valida al arrancar. |
| `CHATBOT_ENABLED` | Manual | `false` durante la validación inicial sin OpenAI; el valor predeterminado es `true`. |
| `OPENAI_API_KEY` | Condicional | Obligatoria únicamente cuando `CHATBOT_ENABLED=true`. |
| `OPENAI_MODEL` | Condicional | Obligatoria únicamente cuando `CHATBOT_ENABLED=true`. |
| `DB_HOST` | Referencia MySQL Railway | Preferir red privada. |
| `DB_PORT` | Referencia MySQL Railway | Railway/MySQL lo proporciona. |
| `DB_USER` | Referencia MySQL Railway | Usuario de staging. |
| `DB_PASSWORD` | Secreto/referencia MySQL | Nunca reutilizar producción. |
| `DB_NAME` | Referencia MySQL Railway | Base vacía de staging. |
| `REDIS_URL` | Secreto/referencia Redis | Instancia o base exclusiva de staging. |
| `REDIS_KEY_PREFIX` | Manual | Prefijo exclusivo que termine en `staging:`. No usar el de producción. |

### HTTP

| Variable | Obligatoria | Valor/criterio |
| --- | --- | --- |
| `HOST` | Sí | `0.0.0.0`. |
| `PORT` | Railway | Railway la inyecta; no fijarla manualmente. |
| `CORS_ORIGINS` | Sí | Origen HTTPS exacto del frontend de staging; sin `*`. |
| `ALLOW_PRIVATE_NETWORK_ORIGINS` | Sí | `false`. |
| `REMINDER_WORKER_ENABLED` | Sí | `false`. |
| `MAIL_DELIVERY_ENABLED` | Sí | `false` durante la validación inicial. |
| `GOVERNMENT_AUTOMATIONS_ENABLED` | Sí | `false` en staging. |

### Worker

| Variable | Obligatoria | Valor/criterio |
| --- | --- | --- |
| `REMINDER_WORKER_ENABLED` | Sí | Inicialmente `false`; habilitarlo solo después de la validación. |
| `MAIL_DELIVERY_ENABLED` | Sí | `false` mientras se prueban ciclos sin correo real. |
| `GOVERNMENT_AUTOMATIONS_ENABLED` | Sí | `false`; el worker actual no las invoca, pero se mantiene la barrera del entorno. |
| `WORKER_INTERVAL_MS` | No | Predeterminado `60000`; distinto solo si una prueba controlada lo requiere. |
| `WORKER_LOCK_TTL_MS` | No | Predeterminado `120000`. |
| `WORKER_LOCK_RENEWAL_MS` | No | Predeterminado `30000`; debe ser menor que el TTL. |
| `REMINDER_RETRY_DELAY_SECONDS` | No | Predeterminado `60`. |

### Base de datos, Redis y cierre

| Variable | Obligatoria | Predeterminado/criterio |
| --- | --- | --- |
| `DB_CONNECTION_LIMIT` | No | `10`; ajustar con los límites reales de MySQL. |
| `DB_CONNECT_TIMEOUT_MS` | No | `10000`. |
| `DB_SSL_MODE` | Sí | `required` si Railway ofrece una cadena verificable; confirmar antes de usar `preferred`. |
| `DB_TIMEZONE` | No | `-06:00`. |
| `REDIS_CONNECT_TIMEOUT_MS` | No | `5000`. |
| `SHUTDOWN_TIMEOUT_MS` | No | `15000`. |

### Integraciones opcionales

| Variable | Cuándo se necesita | Precaución |
| --- | --- | --- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Solo si `MAIL_DELIVERY_ENABLED=true` | Cuenta exclusiva de staging y destinatarios de prueba controlados. |
| `CAPSOLVER_API_KEY` | Solo si se autoriza `GOVERNMENT_AUTOMATIONS_ENABLED=true` | No habilitar en staging inicial; no copiar la clave de desarrollo. |
| `CHATBOT_RAG_ENABLED` | Opcional | `false` si no se suministra el índice. |
| `CHATBOT_DOCUMENT_INDEX_PATH` | RAG habilitado | Ruta dentro de imagen/volumen; predeterminado `var/chatbot-documents/index.json`. |

`SMTP_*`, `MAIL_FROM` y `CAPSOLVER_API_KEY` pueden omitirse mientras sus respectivas barreras permanezcan en `false`. `OPENAI_API_KEY` y `OPENAI_MODEL` pueden omitirse con `CHATBOT_ENABLED=false`; en ese estado no se inicializa el cliente OpenAI, RAG permanece desactivado y las rutas de conversación responden HTTP 503.

## Barreras de staging

- `MAIL_DELIVERY_ENABLED=false` impide crear el envío SMTP desde `sendMail` y también impide verificar la conexión de correo.
- `GOVERNMENT_AUTOMATIONS_ENABLED=false` detiene SAT/Declaraguate antes de abrir Chromium o realizar llamadas externas.
- `REMINDER_WORKER_ENABLED=false` evita iniciar los ciclos periódicos tanto en HTTP como en el proceso worker.
- `CHATBOT_ENABLED=false` impide inicializar OpenAI y deshabilita únicamente las rutas de conversación; el acceso por factura y el portal del cliente permanecen disponibles.
- El worker no recibe dominio público ni healthcheck HTTP.
- `CORS_ORIGINS` contiene únicamente el origen del frontend de staging y `ALLOW_PRIVATE_NETWORK_ORIGINS=false`.
- `REDIS_KEY_PREFIX` aísla sesiones, rate limits y bloqueos distribuidos. La URL también debe apuntar al Redis de staging, nunca al real.
- Los logs no imprimen contraseñas, tokens, cadenas de conexión ni soluciones CAPTCHA.

Las rutas administrativas existentes conservan JWT, sesión Redis y rol. El portal de cliente conserva la sesión temporal emitida al validar la factura; no usa una cuenta administrativa.

## MySQL de staging

Los archivos de `scripts/schema` se aplican únicamente a una base vacía:

1. Confirmar que `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()` devuelve `0`.
2. Aplicar `001_schema.sql`.
3. Aplicar `002_catalogs.sql`.
4. Ejecutar `003_verify.sql` y guardar su salida como evidencia.
5. Registrar la línea base en `SCHEMA_MIGRATIONS` solo después de validar estructura y catálogos.
6. Crear por un procedimiento separado únicamente cuentas y datos claramente ficticios de staging. No importar un respaldo de `Mototec`.

Ejemplo de ejecución desde una terminal autorizada, usando marcadores y solicitud interactiva de contraseña:

```bash
mysql --host=<HOST> --port=<PORT> --user=<USER> -p <DB_NAME> \
  < scripts/schema/001_schema.sql
mysql --host=<HOST> --port=<PORT> --user=<USER> -p <DB_NAME> \
  < scripts/schema/002_catalogs.sql
mysql --host=<HOST> --port=<PORT> --user=<USER> -p <DB_NAME> \
  < scripts/schema/003_verify.sql
```

Para la línea base, calcular primero un checksum reproducible de ambos archivos, sin introducir secretos:

```bash
(cat scripts/schema/001_schema.sql scripts/schema/002_catalogs.sql) | shasum -a 256
```

Insertar manualmente una fila `APPLIED` con versión, checksum, descripción y fecha de finalización. No ejecutar las migraciones históricas sobre el esquema final recién creado.

## Procedimiento futuro en Railway

1. Crear un proyecto de staging y un servicio MySQL vacío.
2. Crear o vincular Redis de staging (Upstash según la arquitectura elegida) y definir un prefijo exclusivo.
3. Inicializar/verificar MySQL con el procedimiento anterior.
4. Crear el servicio HTTP desde la rama autorizada, usando el `Dockerfile`, una réplica, dominio público, comando HTTP y `/health/ready`.
5. Cargar variables de staging con las tres barreras en `false`.
6. Verificar `/health/live` y `/health/ready`; después probar autenticación y rutas con datos ficticios.
7. Crear el worker desde el mismo repositorio/imagen, sin dominio ni healthcheck, una réplica y comando Node directo.
8. Iniciar el worker con `REMINDER_WORKER_ENABLED=false` y confirmar que termina sin ejecutar ciclos.
9. Solo con autorización posterior, habilitar el worker manteniendo correo y automatizaciones gubernamentales deshabilitados.

## Persistencia y costos

El backend y el worker no necesitan volumen para operar. El sistema de archivos de los contenedores es efímero; `capturas` no debe considerarse almacenamiento permanente y el índice RAG requiere imagen, volumen o almacenamiento externo si se habilita.

Los recursos previstos son: un servicio HTTP, un worker, MySQL con volumen y Redis externo (Upstash) o, alternativamente, otro servicio Redis con volumen. El costo depende del consumo real de CPU/RAM, egreso y almacenamiento. Antes de contratar, revisar el plan vigente, límites de réplicas, límites de gasto y precio de volúmenes en la documentación de Railway. Usar red privada entre servicios evita egreso público innecesario.

## Compatibilidad Docker

La imagen fue validada en Linux ARM64 durante la Fase 2 y en Linux AMD64 durante esta Fase 4A. La prueba AMD64 se puede repetir sin servicios externos con:

```bash
docker buildx build --platform linux/amd64 --load \
  -t preventive-bot-backend:phase4a-amd64 .
docker run --rm --platform linux/amd64 \
  preventive-bot-backend:phase4a-amd64 node -p "process.arch"
```

La comprobación AMD64 obtuvo Node 22.23.5, pnpm 10.18.3, Argon2id correcto y Chromium Headless Shell 151.0.7922.34 con lanzamiento/cierre exitoso sin abrir una URL. La imagen resultante ocupó 360235092 bytes (aproximadamente 343.6 MiB).

Con MySQL y Redis deliberadamente ausentes, el proceso HTTP inició, `/health/live` respondió 200 y `/health/ready` respondió 503 con ambos componentes en estado `down`. El worker con `REMINDER_WORKER_ENABLED=false` terminó sin iniciar ciclos. También se comprobó dentro de la imagen que las barreras de correo y SAT/Declaraguate rechazan la operación antes de conectarse.

## Pendientes antes de producción

- Confirmar la arquitectura de construcción que Railway asigne y conservar la evidencia AMD64 si corresponde.
- Confirmar TLS de MySQL y el valor correcto de `DB_SSL_MODE`.
- Crear secretos exclusivos de staging, presupuestos/límites y respaldos de MySQL.
- Definir retención y restauración probada de respaldos.
- Decidir dónde persistir el índice RAG si se habilita.
- Validar SMTP solo con una cuenta y destinatarios de prueba.
- Mantener SAT/Declaraguate deshabilitados hasta una autorización y prueba específica.
