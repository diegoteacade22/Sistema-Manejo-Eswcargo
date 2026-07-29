# Incidente de credenciales - 2026-07-29

## Contencion aplicada

- Se roto la contrasena de PostgreSQL/Supavisor del proyecto productivo.
- Se actualizaron `DATABASE_URL` y `DIRECT_URL` en Vercel y GitHub Actions.
- Se invalido la credencial de base de datos publicada.
- Se rotó `AUTH_SECRET` y se desactivo el login administrativo de emergencia.
- Se invalidaron las contrasenas de 319 clientes y 2 administradores.
- Se reemitio una credencial administrativa aleatoria y se guardo en el
  llavero de macOS con el servicio `ESWCARGO Admin webapp`.
- Se retiraron del repositorio los archivos con secretos y credenciales de clientes.

## Estado operativo

- La aplicacion productiva fue reconstruida con la nueva conexion.
- Los accesos por contraseña permanecen bloqueados hasta emitir credenciales nuevas.
- La nueva contraseña de base de datos se conserva en el llavero de macOS con el
  servicio `ESWCARGO Supabase DB bvpcmghxfwmjdngrumou`.

## Reemision segura

1. Entregar a cada cliente una credencial aleatoria por un canal privado.
2. No generar contraseñas a partir de nombre, numero de cliente o fecha.
3. No exportar credenciales a archivos versionados.

## Pendiente fuera del repositorio

- Rotar la credencial SMTP de `info@eswcargo.com`; el acceso publicado seguia
  autenticando correctamente al cierre de esta revision.
- Purgar los secretos del historial Git despues de confirmar todas las rotaciones.

## Verificaciones externas

- Las dos claves de Gemini detectadas por GitHub fueron rechazadas por Google
  como invalidas y las alertas 1 y 2 se cerraron con resolucion `revoked`.
- La credencial antigua de PostgreSQL fue rechazada despues de la rotacion.
- El `main` publico ya no entrega los archivos sensibles retirados.
