# Chatbot backend

El chatbot ofrece accesos separados para clientes y administradores. No guarda conversaciones en MySQL ni Redis: el frontend conserva temporalmente el historial y lo envía en cada consulta.

Las consultas operativas pasan por un servidor MCP interno de solo lectura y aislado por solicitud. La preparación documental RAG, desactivada por defecto, se documenta en `docs/mcp-rag.md`.

## Formato exacto del chat

`POST /api/chatbot/client/chat` y `POST /api/chatbot/admin/chat` responden `200` con exactamente:

```json
{
  "message": "El último estado registrado es Solicitud primeras placas."
}
```

No se devuelven objetos de motocicleta, llamadas de herramientas ni paginación al frontend. La paginación consultada se usa internamente, pero la API pública devuelve únicamente `message`.

## Respuestas fundamentadas

La llamada a Responses API utiliza `tool_choice: "required"` para obtener una propuesta estructurada de intención. Esa propuesta no ejecuta herramientas de negocio: el backend la valida contra su catálogo, audiencia, destino y parámetros. Después ejecuta como máximo la herramienta MCP autorizada y construye un texto determinista para placas, mantenimientos, motocicletas pendientes y resúmenes por período; el modelo no reescribe esos datos.

Los mantenimientos usan siempre las etiquetas `Fecha del mantenimiento`, `Lectura registrada`, `Próxima lectura registrada`, `Próxima fecha registrada` y `Servicios realizados`. Los valores nulos se muestran como `No registrado`; no se agregan unidades, prioridades, citas ni recomendaciones. Cada próxima fecha o lectura permanece dentro del mantenimiento que la originó. El estado de placas se presenta por nombre y fecha, sin exponer su identificador interno.

Cuando Responses API entrega `response.usage`, el backend registra un evento técnico `chatbot_openai_usage` con el consumo agregado de las llamadas de esa consulta. El evento contiene solo alcance, cantidad de llamadas y tokens de entrada, salida y total; no guarda mensajes, resultados, credenciales ni secretos.

El historial es contexto conversacional no confiable; no concede permisos ni se considera evidencia vigente. Las herramientas devuelven estados explícitos:

- `found`: la consulta terminó y encontró datos.
- `no_records`: la consulta terminó correctamente, pero no hay mantenimientos, próxima lectura/fecha o registros para ese criterio.
- `not_found`: la motocicleta autorizada ya no existe al momento de consultar.

Una excepción de MySQL no se convierte en `no_records`: se propaga y la ruta responde `503`. Así se evita afirmar “no hay información” cuando en realidad falló la consulta.

## Cliente

### Crear sesión

`POST /api/chatbot/client/session`

```json
{
  "serieInvoice": "SERIE-FICTICIA",
  "numberInvoice": "00001234"
}
```

Respuesta `201` para una coincidencia única:

```json
{
  "accessToken": "credencial-opaca-ficticia",
  "tokenType": "Client",
  "expiresIn": 1800
}
```

Los dos identificadores se conservan como texto. La credencial real debe mantenerse en memoria o `sessionStorage`, sin imprimirla ni enviarla a rutas administrativas.

### Consultar

`POST /api/chatbot/client/chat`, con `Authorization: Client <credencial>`:

```json
{
  "message": "¿Cuál es el último estado registrado de mi trámite?",
  "history": [
    { "role": "user", "content": "¿Hay mantenimientos registrados?" },
    { "role": "assistant", "content": "No hay mantenimientos registrados." }
  ]
}
```

La motocicleta autorizada procede exclusivamente de Redis. El cuerpo, mensaje, historial y argumentos del modelo no pueden cambiarla.

### Cerrar sesión

`DELETE /api/chatbot/client/session` usa `Authorization: Client <credencial>` y responde, sin JSON ni cuerpo:

```http
HTTP/1.1 204 No Content
```

Reutilizar luego esa credencial responde `401`:

```json
{
  "message": "Sesión de consulta inválida o vencida"
}
```

## Administrador

`POST /api/chatbot/admin/chat` usa `Authorization: Bearer <JWT>`. El backend valida JWT, sesión Redis, usuario MySQL y `ROIdRol = 1`.

Consulta individual por factura:

```json
{
  "conversationId": "tab_01HXYZ_EXAMPLE",
  "message": "Resume el último estado registrado y los mantenimientos.",
  "target": {
    "type": "invoice",
    "serieInvoice": "SERIE-FICTICIA",
    "numberInvoice": "00001234"
  },
  "history": []
}
```

Consulta por placa:

```json
{
  "conversationId": "tab_01HXYZ_EXAMPLE",
  "message": "Consulta el estado de placas de esta motocicleta.",
  "target": { "type": "plate", "plate": "P000ABC" },
  "history": []
}
```

Sin `target`, solo están disponibles consultas administrativas generales:

```json
{
  "conversationId": "tab_01HXYZ_EXAMPLE",
  "message": "Resume los mantenimientos registrados entre 2026-01-01 y 2026-01-31.",
  "history": []
}
```

La definición unificada de **sin placa registrada** es `MOPlate IS NULL OR TRIM(MOPlate) = ''`. El resumen general, el listado de pendientes y el contador que consume el dashboard aplican el mismo criterio. **Con placa registrada** significa únicamente que el valor no es nulo y contiene al menos un carácter distinto de espacio; no significa que la placa haya sido entregada al cliente.

En el esquema activo `MOPlate` es `NOT NULL` y `UNIQUE`, y el formulario normal de registro exige la placa. Por tanto, el flujo normal actual no permite registrar una motocicleta todavía sin placa. Aunque una llamada directa podría intentar enviar una cadena vacía, el índice único impediría representar de esa manera más de una motocicleta. No se inventó un valor especial, no se modificó el esquema y no se normalizaron registros existentes.

Cuando una búsqueda de clientes devuelve varias opciones, la selección numérica conserva temporalmente el `CUIdCustomer` confirmado por el servidor. El detalle posterior consulta por ese identificador interno; no vuelve a resolver la selección por `CUNIT`, porque el esquema no garantiza que ese campo sea único.

### Catálogo único de consultas

| Capacidad | Audiencia | Datos requeridos | Lectura autorizada | Respuesta |
| --- | --- | --- | --- | --- |
| Resumen de una motocicleta | Cliente/Admin | Motocicleta autorizada | Estado de placas y mantenimientos | Plantilla operativa determinista |
| Estado de placas | Cliente/Admin | Motocicleta autorizada | Último proceso registrado | Plantilla operativa determinista |
| Historial de mantenimientos | Cliente/Admin | Motocicleta autorizada | Mantenimientos y servicios | Plantilla operativa determinista |
| Próximo mantenimiento registrado | Cliente/Admin | Motocicleta autorizada | Último mantenimiento | Plantilla operativa determinista |
| Motocicletas sin placa | Admin | Ninguno | Página y total sin placa | Plantilla operativa determinista |
| Resumen general de motocicletas | Admin | Ninguno | Total, con placa y sin placa | Plantilla operativa determinista |
| Resumen de mantenimientos | Admin | Fecha inicial y final | Conteos del período | Plantilla operativa determinista |
| Documentación aprobada | Cliente/Admin | Pregunta documental | Índice aprobado | No se ofrece mientras RAG esté desactivado |

Este catálogo en código alimenta la clasificación, la validación, la herramienta permitida y la ayuda. Las consultas administrativas de clientes y demás módulos están detalladas en `docs/chatbot-business-catalog.md`. No hay operaciones de escritura.

### Continuidad, `conversationId` y cambio de `target`

El frontend genera un `conversationId` distinto por pestaña y destino. El backend conserva en Redis durante 30 minutos únicamente la capacidad activa, el dato pendiente y parámetros confirmados; no guarda los mensajes completos. La clave también incluye usuario, sesión y audiencia. El estado del frontend no concede permisos ni selecciona una motocicleta: el backend vuelve a resolver y autorizar cada `target`.

Para continuar con la misma motocicleta, el frontend repite el mismo `target` y `conversationId`. Al cambiar de motocicleta usa otro contexto y no copia mensajes del destino anterior. Si omite `target`, aunque el historial mencione una moto, solo están disponibles herramientas administrativas generales. La factura o placa se coloca en `target`, no en `message` ni `history`.

`DELETE /api/chatbot/admin/conversation/:conversationId` elimina el estado temporal de esa conversación autenticada y responde `204`. Una sesión vencida es rechazada antes de leer el estado. El historial sigue siendo contexto visual limitado y ninguna respuesta anterior del asistente se usa como evidencia de datos.

## Cómo enviar `history`

`message` es el mensaje actual. `history` contiene únicamente turnos anteriores y excluye el mensaje actual para no duplicarlo. Tras una respuesta exitosa, se agregan:

```json
[
  { "role": "user", "content": "Texto del mensaje enviado" },
  { "role": "assistant", "content": "Texto recibido en message" }
]
```

Solo se admiten roles `user` y `assistant`. Conservar como máximo los 12 mensajes previos más recientes y no superar 6,000 caracteres sumados. El `message` actual admite de 1 a 1,000 caracteres. Para recortar, conviene eliminar pares antiguos completos.

## Códigos HTTP y cuerpos reales

### `POST /api/chatbot/client/session`

| Estado | Cuerpo JSON | Motivo |
| --- | --- | --- |
| `400` | `{"message":"Serie y número de factura son obligatorios"}` | Algún campo no es string. |
| `400` | `{"message":"Serie y número de factura no son válidos"}` | String vacío o inválido. |
| `404` | `{"message":"Motocicleta no encontrada"}` | Sin coincidencias. |
| `409` | `{"message":"La factura identifica más de una motocicleta"}` | Factura ambigua. |
| `429` | `{"message":"Demasiados intentos. Inténtalo más tarde"}` | Límite por IP; incluye `Retry-After`. |
| `503` | `{"message":"No fue posible validar la factura en este momento"}` | Falla MySQL o Redis. |

### Credencial de cliente y `DELETE`

| Estado | Cuerpo JSON | Motivo |
| --- | --- | --- |
| `401` | `{"message":"Sesión de consulta inválida"}` | Falta header o no usa el esquema `Client`. |
| `401` | `{"message":"Sesión de consulta inválida o vencida"}` | Credencial inexistente, vencida o cerrada. |
| `503` | `{"message":"El servicio de sesiones no está disponible"}` | Redis falla al validar. |
| `503` | `{"message":"No fue posible cerrar la sesión de consulta"}` | Redis falla durante `DELETE`. |

### `POST /api/chatbot/client/chat`

| Estado | Cuerpo JSON | Motivo |
| --- | --- | --- |
| `400` | `{"message":"Revisa el mensaje y los datos de la consulta"}` | Mensaje, historial, paginación o argumentos inválidos. |
| `401` | `{"message":"Sesión de consulta inválida"}` | Falta credencial o asociación de sesión. |
| `401` | `{"message":"Sesión de consulta inválida o vencida"}` | Sesión inexistente, vencida o cerrada. |
| `429` | `{"message":"Has alcanzado el límite temporal de consultas"}` | Límite por sesión; incluye `Retry-After`. |
| `502` | `{"message":"No fue posible preparar una respuesta en este momento"}` | Respuesta incompleta o vacía. |
| `502` | `{"message":"El asistente no está disponible temporalmente"}` | Error OpenAI reconocido por el SDK. |
| `503` | `{"message":"El servicio de sesiones no está disponible"}` | Redis falla antes de la ruta. |
| `503` | `{"message":"No fue posible consultar la información en este momento"}` | Falla de datos u otra dependencia no clasificada. |

### `POST /api/chatbot/admin/chat`

| Estado | Cuerpo JSON | Motivo |
| --- | --- | --- |
| `400` | `{"message":"Revisa el mensaje y los datos de la consulta"}` | Mensaje, historial, `target`, fecha, paginación o argumentos inválidos. |
| `401` | `{"message":"Unauthorized"}` | Bearer, JWT, sesión o usuario inválidos. |
| `403` | `{"message":"Forbidden"}` | Rol insuficiente. |
| `404` | `{"message":"Motocicleta no encontrada"}` | `target` inexistente. |
| `409` | `{"message":"El identificador corresponde a más de una motocicleta"}` | `target` ambiguo. |
| `429` | `{"message":"Has alcanzado el límite temporal de consultas"}` | Límite por usuario e IP; incluye `Retry-After`. |
| `502` | `{"message":"No fue posible preparar una respuesta en este momento"}` | Respuesta incompleta o vacía. |
| `502` | `{"message":"El asistente no está disponible temporalmente"}` | Error OpenAI reconocido por el SDK. |
| `503` | `{"message":"Authentication service unavailable"}` | Redis o MySQL falla durante autenticación. |
| `503` | `{"message":"No fue posible consultar la información en este momento"}` | Falla posterior de datos u otra dependencia. |

## Límites

- Sesión cliente: 30 minutos.
- Factura: 5 intentos por IP cada 15 minutos.
- Chat: 20 solicitudes por minuto por sesión, o por usuario Admin e IP.
- Mensaje: 1,000 caracteres.
- Historial: 12 mensajes y 6,000 caracteres.
- Página solicitada por herramienta: máximo 20 elementos.
- Una herramienta obligatoria por chat y una ronda. Las respuestas actuales son deterministas después de la consulta y usan 1 llamada al modelo para seleccionar la consulta autorizada.
- Salida: 512 tokens; timeout 30 segundos; 0 reintentos.

## Prueba de integración real preparada

`scripts/test-chatbot-integration.ts` prepara: sesión de cliente, consulta de placas, consulta de mantenimientos, consulta Admin individual, resumen Admin, cierre de sesión y rechazo posterior de la credencial. El script carga `.env.chatbot-test.local`, valida los fixtures, crea la sesión administrativa ficticia y arranca un servidor hijo con exactamente el mismo objeto de entorno.

Está bloqueada salvo que `NODE_ENV=test`, `DB_NAME` contenga `test`, `CHATBOT_INTEGRATION_CONFIRM_FIXTURES=true`, `CHATBOT_TEST_ALLOW_EXISTING_REDIS=true` y `REDIS_KEY_PREFIX` sea exactamente `preventive-bot:test:chatbot:`. No modifica datos de negocio ni imprime tokens, factura, credenciales o respuestas del modelo.

El script comprueba directamente `SELECT DATABASE()`, la factura única y el Admin ficticio antes de arrancar el servidor. Tras crear la sesión cliente por HTTP, verifica que su clave hash exista en el mismo Redis configurado. Esto comprueba el entorno efectivo, no solamente el nombre de la base.

Variables locales necesarias:

```dotenv
CHATBOT_INTEGRATION_CONFIRM_FIXTURES=true
NODE_ENV=test
PORT=3301
CHATBOT_TEST_INVOICE_SERIES=CHATBOT-TEST
CHATBOT_TEST_INVOICE_NUMBER=00000001
CHATBOT_TEST_PERIOD_START=2026-01-01
CHATBOT_TEST_PERIOD_END=2026-12-31
```

Requisitos:

- MySQL local disponible y el usuario habitual con permiso para crear la base aislada.
- Acceso al mismo servicio Redis configurado en `.env`, aislado con el prefijo exclusivo `preventive-bot:test:chatbot:`.
- Copia `.env.chatbot-test.local`, ignorada por Git, creada desde `.env.chatbot-test.example`.
- `OPENAI_API_KEY` y `OPENAI_MODEL` válidos en el backend.
- Los fixtures de `test/fixtures/chatbot-test.sql`, que crean una factura, dos motos, procesos, mantenimiento, servicio y Admin ficticios.

La preparación lee las conexiones MySQL, Redis y OpenAI desde `.env`, pero no modifica ese archivo. `.env.chatbot-test.local` sobrescribe únicamente el nombre de base, puerto HTTP, JWT, prefijo Redis y valores de fixtures. El script elimina y recrea exclusivamente `preventive_bot_chatbot_test`. En Redis usa `SCAN` con el patrón `preventive-bot:test:chatbot:*` y elimina solo las coincidencias; no utiliza `FLUSHDB` ni `FLUSHALL`.

Preparación exacta con servicios locales:

```bash
cp .env.chatbot-test.example .env.chatbot-test.local
# Establecer un JWT_SECRET exclusivo de prueba en .env.chatbot-test.local.
CHATBOT_TEST_ENV_FILE=.env.chatbot-test.local node --import tsx scripts/prepare-chatbot-test-environment.ts
```

Comando preparado y no ejecutado:

```bash
CHATBOT_TEST_ENV_FILE=.env.chatbot-test.local node --import tsx scripts/test-chatbot-integration.ts
```

El script arranca y detiene su propio servidor con ese mismo entorno; no se debe ejecutar `pnpm dev` en paralelo. Hay cuatro solicitudes de chat y cada respuesta termina después de la consulta autorizada. El máximo actual es **4 solicitudes reales a OpenAI**. Crear/cerrar sesión y comprobar el rechazo no llaman a OpenAI. El script agrega `response.usage` y reporta llamadas y tokens cuando el SDK los proporciona.

Cada respuesta se valida antes de iniciar el escenario siguiente. Si falla la correspondencia con los fixtures o la calidad determinista, el script lanza el error inmediatamente, omite las consultas restantes y ejecuta de todos modos el bloque de limpieza de sesiones y claves con el prefijo exclusivo.

## Variables principales

Se requieren `OPENAI_API_KEY` y `OPENAI_MODEL`; `.env.example` usa placeholders. Nunca deben enviarse al frontend ni registrarse.
