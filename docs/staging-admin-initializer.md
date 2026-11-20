# Inicialización temporal del administrador de staging

Este mecanismo crea únicamente el primer administrador del entorno Railway de staging. Está separado de las rutas normales de autenticación y no se ejecuta durante el desarrollo local ni en producción.

## Barreras obligatorias

La inicialización solo continúa cuando se cumplen simultáneamente:

- `STAGING_ADMIN_INIT_ENABLED=true`.
- `NODE_ENV=production`.
- `RAILWAY_PROJECT_ID=1ff8317e-f21b-4266-83a6-2a133b890cef`.
- `RAILWAY_ENVIRONMENT_ID=96107c3b-b128-4044-8079-3017fd2586e2`.
- `RAILWAY_SERVICE_ID=cf6abb52-944c-46d3-8b08-090fd81e4860` (únicamente `backend-http-staging`).
- `STAGING_ADMIN_PASSWORD_HASH` contiene un hash Argon2id compatible con los parámetros del servicio de contraseñas.

Si alguna condición no se cumple, el inicializador devuelve `skipped` o `preflight_failed` y no modifica la base de datos.

## Seguridad y ejecución controlada

El hash se genera localmente sin imprimirlo ni guardarlo en un archivo:

```bash
cd /Users/sheyarreaga/Desktop/Back-Preventive-Bot
pnpm admin:generate-staging-hash
```

El script solicita la contraseña dos veces usando una terminal interactiva de macOS, copia el hash al portapapeles mediante `pbcopy` y no lo muestra. El portapapeles es temporal, pero puede ser leído por otras aplicaciones; debe pegarse inmediatamente en una variable secreta de Railway y limpiarse después. No se debe configurar el hash mediante un comando que lo deje en el historial del shell.

Antes de habilitar el despliegue, configurar en Railway únicamente en `staging`:

```text
STAGING_ADMIN_INIT_ENABLED=true
STAGING_ADMIN_PASSWORD_HASH=<hash pegado como secreto>
```

No registrar estas variables en Git, `.env`, documentación, capturas ni logs. El servicio nunca imprime el hash ni la contraseña.

## Comprobaciones e inserción

Antes de abrir la transacción se comprueban la estructura de `USERS`, las columnas requeridas, la restricción única del correo, el rol `Admin`, la ausencia del correo autorizado y la ausencia de administradores.

Luego se obtiene un bloqueo MySQL, se repiten las comprobaciones dentro de la transacción, y se inserta únicamente el administrador autorizado. Si ya existe un administrador o el correo está registrado, el resultado es `already_exists` y no se modifica ningún registro.

Después del `COMMIT` se verifica el ID, correo, rol y que el campo de contraseña comience con `$argon2id$`, sin devolver el hash. Si la verificación posterior falla, el resultado es `verification_failed` y se debe comprobar el registro antes de repetir cualquier operación.

## Reversión

Después de confirmar la creación:

1. Desactivar `STAGING_ADMIN_INIT_ENABLED`.
2. Eliminar `STAGING_ADMIN_PASSWORD_HASH` de Railway.
3. Borrar el hash del portapapeles.
4. Desplegar nuevamente para retirar el mecanismo temporal, sin eliminar al administrador.

La reversión del código no modifica usuarios ni contraseñas. No se debe borrar el administrador como parte de esta limpieza.

## Pruebas

Las pruebas automatizadas cubren inicialización fuera de staging, hash inválido, preflight, duplicados, creación controlada, errores antes del `COMMIT` y errores posteriores al `COMMIT`. Las pruebas usan una conexión MySQL simulada y no insertan datos reales.
