# Eliminar una ocurrencia preventiva

En Mantenimientos > Acciones y en la vista semanal, los perfiles ADMIN, TALLER y PROVEEDURIA_TALLER pueden eliminar un preventivo PROGRAMADO sin ejecucion, cierre ni registros vinculados. Se comprueba la sede en el servidor. El formulario pide confirmacion; no hay eliminacion masiva.

La operacion bloquea primero la unidad y despues el mantenimiento, verifica las tablas ejecuciones, mantenimiento_mecanicos, planes_taller y reportes_supervisores y guarda una copia JSON con usuario, fecha y numero original en preventivos_eliminados antes de borrar, dentro de la misma transaccion. Si algo falla se revierte todo. Los correctivos y preventivos realizados no se eliminan por esta ruta.

El generador consulta las fechas eliminadas antes de insertar y la vista semanal tampoco vuelve a presentar esas ocurrencias como previstas. La frecuencia y el resto de semanas no cambian. Las constancias son permanentes; reactivar expresamente una fecha eliminada requiere revision administrativa, no borrar la constancia desde la interfaz.

La tabla se crea de forma idempotente por el modulo. Fue preparada en la base configurada el 19 de octubre de 2026 sin eliminar mantenimientos existentes.

Pruebas: node --test tests/preventivosEliminacion.test.js tests/preventivosSemanales.test.js
