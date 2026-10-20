# Permisos por departamento

La configuracion de usuario_accesos_personales conserva el formato previo de un departamento y permite adicionales por area. Cada solicitud carga el perfil del departamento activo y valida en servidor las rutas y metodos.

Para Francini Brenes se conserva el perfil y rol de Proveeduria sin modificarlos. Se agregan Taller y Carburacion a usuario_departamentos. Las sesiones anteriores caducan al cambiar las asignaciones.

- Taller: TALLER_COMPRAS_LECTURA. Solo listados, detalles, PDF/Excel de ordenes y facturas y sus adjuntos; no formularios, pagos, edicion, eliminacion, asientos ni otros modulos.
- Carburacion: CARBURACION_SIN_FINANZAS. Gestion de clientes, expedientes, estaciones y proveedores. Sin ordenes, facturas, pagos, colillas ni sus informes. El inicio tampoco consulta ni muestra indicadores financieros.
- La edicion de clientes necesita ademas su asignacion en carburacion_cliente_editores.
- Un perfil de un solo departamento sigue funcionando igual. El editor actual de perfiles reemplaza la configuracion al guardar; revisar asignaciones adicionales antes de cambiar este perfil desde el editor.

Pruebas: tests/permisosPorDepartamento.test.js.
