# Catálogo de negocio del chatbot administrativo

Este catálogo refleja el esquema inspeccionado mediante `INFORMATION_SCHEMA` y las lecturas implementadas. Todas las capacidades son de solo lectura, requieren JWT, sesión Redis activa, usuario MySQL existente y rol administrador (`ROIdRol = 1`). El chatbot de clientes no recibe estas capacidades.

| Módulo | Información y filtros | Relaciones confirmadas | Función de lectura | Exclusiones y límites |
| --- | --- | --- | --- | --- |
| Clientes | Totales; activos/inactivos; nuevos del mes; búsqueda por nombre, DPI, NIT, teléfono o correo; detalle por NIT | `CUSTOMER.CUIdCustomer → MOTORCYCLES.CUIdCustomer` | `getCustomerSummary`, `searchCustomers`, `getCustomerDetailByNit` | NIT no es único en el esquema: múltiples coincidencias se reportan como ambigüedad. Listados máximo 20. |
| Motocicletas | Total, con/sin placa; listado; características; selección por placa o factura | Cliente, procesos y mantenimientos mediante claves confirmadas | `getMotorcycleFleetSummary`, `getMotorcycleList`, resolutores existentes | Listados omiten VIN, chasis y datos de factura. Tener placa registrada no significa entrega. |
| Placas | Estado vigente, historial completo y pendientes | `MOTORCYCLES → PROCESSING → STATE_PLATE` | `getMotorcycleSummary`, `getPlateHistory`, `getPendingPlates` | Estado vigente es el mayor `PRIdProcess`. Se omiten observaciones. |
| Mantenimientos | Historial, servicios, próxima fecha/lectura registrada y resumen por período | `MOTORCYCLES → MAINTENANCE → DETAIL_MAINTENANCE → SERVICES` | Lectores existentes de mantenimiento | Próximos valores no son citas. Se omiten observaciones y `SEAmount`. |
| Servicios | Catálogo, descripción, lectura/tiempo recomendado y precio de referencia registrados | Relación histórica por `DETAIL_MAINTENANCE.SEIdService` | `getServiceCatalog` | No son recomendaciones propias ni precios definitivos. No se filtra por `SEState`. |
| Repuestos | Nombre, marca y descripción | Ninguna relación con mantenimiento en el esquema | `getSparePartsCatalog` | No se asocian repuestos a mantenimientos. |
| Usuarios y roles | Nombre, correo, teléfono, rol y fecha registrada | `USERS.ROIdRol → ROL.ROIdRol` | `getUsersAndRoles` | Nunca devuelve `USPassword`, sesiones, tokens o secretos. |
| Dashboard | Clientes totales/activos/nuevos; motos totales/con placa/sin placa | Agregados directos, sin joins multiplicadores | Composición de `getCustomerSummary` y `getMotorcycleFleetSummary` | El endpoint `/api/dashboard` continúa siendo un placeholder; el chatbot calcula sus indicadores con lecturas propias. |
| Recordatorios | Título, descripción, fecha programada registrada, tipo, estado y moto relacionada | `REMINDER → MAINTENANCE → MOTORCYCLES` | `getReminderList` | `REFSend` se conserva como dato registrado internamente; la respuesta no afirma que una notificación fue entregada. |
| Configuración | No disponible | No existe tabla de configuración confirmada | Ninguna | El chatbot no la ofrece. |

## Inconsistencia confirmada

En el esquema activo `MOTORCYCLES.MOPlate` figura como `NOT NULL` y `UNIQUE`, mientras que el formulario normal exige la placa. Para lecturas, resumen y pendientes comparten el criterio compatible `MOPlate IS NULL OR TRIM(MOPlate) = ''`; así también se detectan datos heredados vacíos o con espacios. Esto no modifica registros ni resuelve la limitación de alta: representar varias motos sin placa requiere una decisión de esquema fuera de este alcance.

## Ejemplos administrativos

- `¿Cuántos clientes hay?`
- `Busca al cliente Ana`
- `Detalle del cliente con NIT 000000-0`
- `Lista las motocicletas registradas`
- `Dame un resumen general de motocicletas`
- `Historial del trámite de placas de la motocicleta seleccionada`
- `Resume los mantenimientos del mes pasado`
- `Muéstrame el catálogo de servicios`
- `Lista los repuestos registrados`
- `Lista usuarios y roles`
- `Muéstrame los recordatorios registrados`
- `Resumen del dashboard`

## Evaluación posterior preparada

La evaluación real posterior debe cubrir 12 escenarios, por lo que su máximo será de **12 solicitudes reales a OpenAI**, sin reintentos. Debe usar datos ficticios, RAG desactivado y lectores simulados o la base aislada de pruebas. No se ejecutó en esta fase.

Escenarios: resumen y búsqueda de clientes; detalle ambiguo; motos de un cliente; cambio clientes→motocicletas; resumen/listado de motos; historial de placas; mantenimiento multivuelta; servicios; repuestos; usuarios/roles; recordatorios/dashboard y denegación de una capacidad administrativa desde acceso de cliente.
