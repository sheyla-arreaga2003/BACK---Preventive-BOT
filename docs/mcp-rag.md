# MCP y preparación de RAG del chatbot

## Arquitectura

El contrato HTTP del chatbot no cambia. Las rutas continúan autenticando al cliente o al administrador, resuelven la motocicleta en el servidor y entregan al servicio únicamente su identificador interno validado.

Para cada consulta operativa compatible se crea un `McpServer`, un `Client` y un par `InMemoryTransport` nuevos. El servidor registra exclusivamente las herramientas permitidas para esa solicitud. La identidad, el rol y la motocicleta quedan capturados en el cierre del servidor y nunca se aceptan como argumentos del modelo. La conexión se cierra al terminar, incluso si la consulta falla. No existe un endpoint MCP público.

Flujo:

1. La ruta conserva autenticación, autorización, límites y resolución de destino actuales.
2. El modelo propone una intención mediante una salida estructurada; no recibe herramientas de negocio en esa fase.
3. El backend valida la propuesta contra el catálogo, la audiencia, la selección de motocicleta y los parámetros fundamentados en el mensaje. Solo entonces expone una herramienta compatible por MCP.
4. Los lectores SQL existentes realizan exclusivamente consultas de lectura.
5. Las respuestas operativas siguen usando las plantillas deterministas existentes.
6. Las consultas documentales pasan por la herramienta MCP `search_approved_documents`. Si RAG está apagado, no se abre el índice ni se inventa una respuesta.

El historial se conserva únicamente como contexto conversacional: no prueba el estado actual, no concede permisos y no se indexa.

## Herramientas MCP internas

- Motocicleta autorizada: resumen de motocicleta, historial de mantenimientos, próximo mantenimiento registrado y vista combinada.
- Administración general: motocicletas pendientes de placa y resumen de mantenimientos por período.
- Documentación: búsqueda de fragmentos aprobados, filtrada previamente por audiencia `client` o `admin`.

Todas tienen esquemas Zod estrictos de entrada y salida, anotaciones de solo lectura y no aceptan usuario, rol, factura, placa ni identificador de motocicleta. El resultado viaja como contenido estructurado MCP. Los errores MCP se convierten en los mensajes HTTP comprensibles ya utilizados por las rutas.

## Clasificación y fechas

Los saludos, consultas de capacidades y preguntas fuera del alcance no fuerzan una herramienta de negocio. La clasificación estructurada sí utiliza una llamada al modelo; después el backend puede responder o pedir aclaración sin consultar MySQL. Las consultas administrativas de clientes se resuelven mediante herramientas específicas y nunca se convierten en mantenimientos.

Los resúmenes de mantenimiento requieren un período en el mensaje actual. Las fechas anteriores del historial no se reutilizan. El backend acepta dos fechas ISO explícitas o referencias relativas reconocidas y calcula estas últimas con `America/Guatemala`; no acepta fechas inventadas por la propuesta. La respuesta muestra el período interpretado. Si faltan fechas, se pide aclaración.

Cuando el siguiente mensaje contiene únicamente el período solicitado, el backend puede pasar al clasificador el último mensaje del usuario como intención pendiente. No pasa la respuesta del asistente y valida las fechas exclusivamente desde el mensaje nuevo. Esta continuidad solo se habilita para consultas administrativas generales sin motocicleta seleccionada, evitando transportar contexto entre motocicletas.

## Índice documental

RAG está desactivado por defecto. El índice es un archivo JSON local separado de MySQL, Redis y OpenAI. No contiene datos operativos, clientes, facturas, historiales privados ni conversaciones.

Cada documento guarda:

- `documentId`, `title`, `version` y `source`.
- `effectiveDate`, `audience` y `status` (`active` o `withdrawn`).
- `contentHash` SHA-256.
- Fragmentos con `id`, `section`, `page` y `text`.

La primera implementación admite `.md` y `.txt`. Como esos formatos no aportan páginas reales, `page` se conserva como `null`; no se inventa. El comando rechaza contenido duplicado y combinaciones repetidas de documento/versión, y reemplaza el índice atómicamente. Para retirar una versión se marca `withdrawn` en el manifiesto y se vuelve a generar. Para actualizarla se agrega la nueva versión y se retira la anterior explícitamente.

La recuperación actual es léxica y local, por lo que no requiere embeddings, proveedor externo ni costo adicional. Filtra estado y audiencia antes de ordenar o devolver fragmentos. Los fragmentos se tratan como datos no confiables: no pueden cambiar permisos ni activar operaciones. Una referencia visible tiene este formato:

```text
[Fuente: Título, versión 1.0, sección Nombre, página 3]
```

Cuando la página no existe se muestra `sin página`. La orientación documental y los datos operativos se consultan por capacidades separadas; un documento nunca demuestra el estado operativo actual. Si un mismo documento tiene varias versiones activas o no declara vigencia, la respuesta informa esa limitación.

## Configuración y activación

Variables (los valores son ejemplos, no secretos):

```dotenv
CHATBOT_RAG_ENABLED=false
CHATBOT_DOCUMENT_INDEX_PATH=var/chatbot-documents/index.json
```

Preparación:

```bash
cp rag/documents.manifest.example.json rag/documents.manifest.json
# Crear únicamente documentos aprobados dentro de la ruta elegida en el manifiesto.
pnpm chatbot:index-documents -- rag/documents.manifest.json
pnpm typecheck
pnpm test
```

Después de revisar el índice, cambiar `CHATBOT_RAG_ENABLED=true` y reiniciar el backend. `var/chatbot-documents/` está ignorado por Git. No se debe habilitar RAG si no hay documentos aprobados.

## Evaluación de intención

Las pruebas locales usan propuestas simuladas para comprobar el control posterior del backend: intención, herramienta, parámetros fundamentados, permisos y respuesta determinista. Incluyen paráfrasis, errores ortográficos, ambigüedad, cambio de tema, una consulta combinada, solicitudes fuera del alcance y los dos fallos observados (NIT y conteo de clientes). Estas pruebas demuestran que una propuesta inválida queda bloqueada, pero no demuestran por sí solas que el modelo real clasificará correctamente todos los textos.

Se preparó una evaluación real acotada de 10 escenarios. No consulta MySQL, no ejecuta herramientas de negocio y realiza como máximo una solicitud de clasificación por escenario: 10 solicitudes reales a OpenAI, sin reintentos automáticos por la configuración existente.

No se ejecutó. Antes de autorizar su costo:

```bash
CHATBOT_EVAL_CONFIRM_REAL=true pnpm chatbot:evaluate-intents
```

El script imprime únicamente etiqueta del caso, resultado esperado, resultado obtenido y aprobación; no imprime mensajes completos, credenciales ni secretos.

### Corrección focalizada de clasificación

La evaluación inicial encontró cuatro confusiones: conteo de clientes, documentación aprobada, una operación de escritura y una referencia ambigua. La causa fue una definición demasiado breve de `unsupported` y `clarification`, más una descripción documental que condicionaba la intención al estado de RAG.

El catálogo ahora incluye ejemplos variados por capacidad y separa la intención `approved_documents` de la disponibilidad de recuperación. Después de la propuesta del modelo, una política semántica de backend protege familias completas de solicitudes: escrituras, agregados no soportados, preguntas documentales y referencias sin antecedente. No ejecuta herramientas ni cambia permisos.

Se preparó una evaluación focalizada de ocho solicitudes reales como máximo: cada uno de los cuatro fallos y una paráfrasis nueva. Está bloqueada por defecto, exige RAG desactivado y no ejecuta herramientas de negocio:

```bash
CHATBOT_CLASSIFICATION_EVAL_CONFIRM_REAL=true pnpm chatbot:evaluate-classification-fixes
```

No se ejecutó durante la corrección.

## Dependencias y operación

Se usan `@modelcontextprotocol/server`, `@modelcontextprotocol/client` y `zod`. El transporte interno no abre puertos adicionales ni necesita Docker. El índice local requiere respaldo y permisos de lectura para el proceso del backend. La búsqueda léxica no tiene costo por llamada; las consultas operativas conservan el consumo del modelo configurado. No se realizaron cargas, embeddings ni llamadas reales a OpenAI durante esta implementación.

Limitaciones actuales:

- Solo se extraen `.md` y `.txt`; PDF/DOCX requieren un extractor revisado antes de habilitarlos.
- La recuperación es léxica, no semántica.
- No se añadieron GraphRAG, MCP remoto ni escrituras de negocio.
- El administrador documental debe definir y revisar audiencia, versión, vigencia y retiro de cada archivo.
