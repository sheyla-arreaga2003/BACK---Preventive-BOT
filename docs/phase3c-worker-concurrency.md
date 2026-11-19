# Fase 3C: prevención de ejecuciones duplicadas

Fecha de validación: 14 de noviembre de 2026.

## Problema original

El runner evitaba solapamientos solamente mediante una promesa en memoria. Dos procesos distintos podían consultar simultáneamente los mismos recordatorios `PENDING`, enviar el mismo correo y actualizar después el mismo registro. Las citas usaban actualizaciones condicionales y las notificaciones una clave única, por lo que eran idempotentes en MySQL, pero seguían ejecutando consultas duplicadas.

## Solución implementada

Cada ciclo (`recordatorios` y `citas-notificaciones`) adquiere una concesión Redis independiente mediante `SET NX PX`. La concesión contiene un UUID del propietario, se renueva antes de vencer y se libera con un script Lua que compara el propietario antes de borrar. Otro script Lua renueva únicamente la concesión propia.

Las tareas comprueban la propiedad antes de cada unidad de trabajo. Si Redis deja de estar disponible o cambia el propietario, se lanza `DistributedLockLostError` y el ciclo se detiene. Los manejadores internos de citas y notificaciones no absorben ese error.

Los recordatorios incluyen una segunda defensa en MySQL:

1. una transacción selecciona un único recordatorio mediante `FOR UPDATE SKIP LOCKED`;
2. lo mueve atómicamente de `PENDING` (1) a `PROCESSING` (4);
3. solo el registro reclamado puede pasar a `SENT` o registrar un fallo;
4. un fallo recuperable vuelve a `PENDING` y respeta `REMINDER_RETRY_DELAY_SECONDS`;
5. el tercer fallo conserva la regla existente y pasa a `ERROR`.

Si se pierde la concesión antes de iniciar el envío, la reclamación vuelve a `PENDING`. Si se pierde durante o después del envío, el registro permanece en `PROCESSING` para conciliación manual: reenviarlo automáticamente podría duplicar un correo que el proveedor aceptó antes de un timeout.

No fue necesaria una migración. Se reutilizaron `REState`, `REAttemptedAt`, `RETries` y el estado `PROCESSING` existentes.

## Variables

- `WORKER_LOCK_TTL_MS` (predeterminado: 120000).
- `WORKER_LOCK_RENEWAL_MS` (predeterminado: 30000).
- `REMINDER_RETRY_DELAY_SECONDS` (predeterminado: 60).
- `REDIS_KEY_PREFIX`, que debe ser exclusivo por entorno.

La renovación debe ser menor que la mitad del TTL. El código limita valores inseguros, pero producción debe conservar margen suficiente para pausas de red.

## Pruebas reales aisladas

Se utilizó MySQL 8.4 y Redis 7 en una red Docker interna, sin puertos publicados. Los datos usaron exclusivamente identificadores `PB3C` y correos `.invalid`. El SMTP fue un hostname inexistente dentro de la red privada.

Resultados:

- dos workers simultáneos produjeron un solo intento de correo;
- el segundo worker omitió el ciclo al encontrar el bloqueo ocupado;
- un reintento elegible aumentó `RETries` de 1 a 2, no a 3;
- el tercer intento pasó el recordatorio a `ERROR` y generó un único aviso `EMAIL_FAILED`;
- no existieron claves de deduplicación repetidas;
- una tarea de siete segundos conservó el bloqueo de cinco segundos gracias a la renovación;
- otro proceso no pudo adquirirlo durante la renovación;
- después de la liberación, el siguiente propietario lo adquirió;
- un propietario distinto no pudo eliminar el bloqueo;
- después de matar al propietario, el TTL permitió una adquisición posterior;
- al detener Redis, la tarea terminó con `DistributedLockLostError` y no continuó;
- el proceso Node directo recibió `SIGTERM`, esperó sus tareas y finalizó con código 0.

Pruebas del proyecto:

- `pnpm typecheck`: aprobado;
- `pnpm test`: 155 aprobadas, 0 fallidas;
- `pnpm build`: aprobado;
- `git diff --check`: aprobado.

## Riesgos residuales

SMTP no ofrece una transacción conjunta con MySQL. Si el proveedor acepta el correo pero la conexión se corta antes de responder, no puede determinarse automáticamente si fue entregado. Ese registro queda en `PROCESSING` y requiere conciliación; no se promete entrega exactamente una vez.

El bloqueo Redis evita ciclos simultáneos y la reclamación MySQL evita que dos procesos tomen el mismo registro. Aun así, se recomienda un único servicio worker en Railway para reducir carga y simplificar operación.

## Arquitectura preparada para Railway

- servicio HTTP: `REMINDER_WORKER_ENABLED=false`;
- servicio worker: una réplica, Redis compartido y `REMINDER_WORKER_ENABLED=true`;
- inicio del worker: `node --enable-source-maps dist/worker.js` es el comando verificado para recibir `SIGTERM` como proceso principal;
- Redis y `REDIS_KEY_PREFIX` exclusivos para staging;
- MySQL compartido dentro del mismo entorno;
- no ejecutar migraciones durante el arranque.

`pnpm start:worker` inicia el mismo archivo, pero en la prueba Docker pnpm no reenvió `SIGTERM` al proceso hijo. Si Railway ejecuta ese comando mediante un supervisor que envía la señal al grupo completo puede utilizarse; el comando Node directo es la opción comprobada.

## Limpieza

Los contenedores, la red, los volúmenes, la imagen y los datos `PB3C` se eliminaron al concluir. No se utilizó MySQL `Mototec`, Upstash Redis, SMTP real, SAT ni Declaraguate.
