# Marcas de ingreso de Taller

- Registro: cuenta actual de Saul Cardenas (`mecanico_limon`). Consulta: cuenta `taller`, usada por jefatura y asistencia, y administradores desde Taller o Administracion. El administrador solo consulta; no registra marcas.
- Permisos adicionales, privados de este modulo, en `taller_marcas_accesos`. Se verifican en servidor para cada solicitud y foto. El departamento activo debe ser Taller.
- Ruta `/marcas-ingreso`: reloj, camara y ultimas marcas propias. Consulta `/marcas-ingreso/historial`: filtros por fecha de Costa Rica y paginacion.
- Solo `getUserMedia`, video en vivo y captura a canvas; no hay input de archivos, galeria ni alternativa de adjuntar imagenes. Requiere HTTPS, permiso de camara y un navegador compatible.
- Un reto de sesion dura dos minutos. Las fotos JPEG se limitan a 1 MB y 1600 px por lado. No se acepta reutilizar exactamente la misma foto ni el mismo reto.
- Un navegador no certifica que la camara sea fisica ni permite impedir peticiones manipuladas o camaras virtuales. No se implementa reconocimiento facial, verificacion de identidad biometrica ni prueba antifraude. Para requisitos probatorios estrictos se necesita hardware o una aplicacion y politicas administradas.
- Entradas y salidas se alternan y se serializan por empleado con bloqueo SQL. No hay edicion ni eliminacion de marcas. La hora es UTC del servidor de base de datos; se muestra en Costa Rica, nunca se utiliza la hora enviada por el dispositivo.
- Fotos privadas en MySQL, incluidas en el respaldo SQL; no se publican en `/uploads`. Definir una politica empresarial de retencion de evidencia y capacidad del respaldo antes de ampliar a mas empleados.
- Aplicar `202610200002_marcas_ingreso_taller.sql`. No se crean marcas de prueba en produccion.
