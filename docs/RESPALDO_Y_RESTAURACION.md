# Respaldo y restauracion de Taller

## Arquitectura actual

- La aplicacion corre en Render y guarda documentos bajo `/var/data/uploads` mediante `UPLOAD_ROOT`.
- La base MySQL esta en Railway; Render recibe sus credenciales por variables `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD` y `MYSQLDATABASE`.
- El disco persistente de Render tiene 1 GB. Guardar archivos en el disco evita que se pierdan al reiniciar o desplegar, pero no sustituye un respaldo externo.

## Configuracion pendiente en los proveedores

1. En Railway, abra el proyecto y el servicio MySQL que usa `tomza-mant`. En **Backups**, configure como minimo una copia diaria y confirme que exista una copia completada reciente. Railway permite programar respaldos diarios, semanales y mensuales; conserve tambien una frecuencia semanal si necesita una ventana de recuperacion mas amplia.
2. Revise con el responsable tecnico la opcion **Point-in-Time Recovery (PITR)** de MySQL. Railway indica una ventana de siete dias. Habilitarlo en MySQL puede redeplegar el servicio y causar una interrupcion breve; acuerde una ventana de mantenimiento y revise primero si el servicio tiene un comando de inicio personalizado.
3. En Render, abra el servicio `tomza-mant`, vaya a **Disk** y confirme que el disco `tomza-uploads` esta montado en `/var/data/uploads` y que hay snapshots recientes. Render crea snapshots diarios del disco persistente y los conserva al menos siete dias.
4. Defina una copia cifrada fuera de Railway/Render para documentos criticos. Los respaldos nativos protegen contra fallos operativos, pero una segunda ubicacion ayuda ante eliminacion del proyecto o perdida de acceso a la cuenta. No guarde copias ni credenciales en Git.

## Prueba de restauracion

Haga la primera prueba en una base y un servicio de prueba, nunca sobre la base productiva.

1. En Railway, restaure una copia reciente como una nueva instancia o cree una recuperacion PITR. Mantenga la base original sin cambios.
2. Configure un servicio aislado para apuntar a esa instancia restaurada. No habilite correo, notificaciones ni integraciones que puedan enviar mensajes reales desde la prueba.
3. Antes de abrir escrituras, verifique conectividad, estructura de tablas, inicio de sesion de prueba y datos conocidos: usuarios, unidades, mantenimientos, movimientos de bodega, entregas, rellenos de aceite y archivos asociados.
4. Compare conteos y fechas con la base original para el punto de restauracion elegido. Registre fecha, responsable, duracion, errores y resultado.
5. Para documentos, verifique que se puedan abrir archivos de muestra desde el almacenamiento restaurado. No restaure el snapshot sobre el disco productivo como ensayo: Render reemplaza el estado actual del disco y se perderian los cambios posteriores al snapshot.
6. Solo ante una recuperacion real, y despues de aprobar la instancia restaurada, cambie las variables de conexion del servicio y confirme `/ready`. Conserve la base anterior hasta validar el sistema y obtener aprobacion.

## Lista de control

- [ ] Railway: respaldo diario activo y ultima ejecucion exitosa verificada.
- [ ] Railway: retencion y responsables de acceso documentados.
- [ ] Railway: PITR evaluado; interrupcion y cambio de imagen entendidos antes de habilitarlo.
- [ ] Render: `UPLOAD_ROOT` apunta al disco persistente y hay snapshots recientes.
- [ ] Existe copia cifrada independiente para los archivos que no se pueden perder.
- [ ] Se completo y documento una restauracion de prueba aislada de base de datos y archivos.
- [ ] Responsable funcional aprobo el tiempo de recuperacion y los datos restaurados.

## Referencias oficiales

- [Railway MySQL](https://docs.railway.com/databases/mysql)
- [Railway Backups](https://docs.railway.com/volumes/backups)
- [Railway Point-in-Time Recovery](https://docs.railway.com/volumes/point-in-time-recovery)
- [Render Persistent Disks](https://render.com/docs/disks)

Este procedimiento describe lo que debe configurarse y probarse en las cuentas de los proveedores. El repositorio no puede confirmar por si solo que los respaldos esten habilitados; hasta completar y registrar las casillas anteriores, el criterio de recuperacion de V1 sigue pendiente.
