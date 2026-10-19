# Inicio empresarial

La entrada publica `/` presenta departamentos en barra lateral y abre el login
del departamento elegido. Al autenticar, el destino normal es `/inicio`, no el
dashboard del ultimo departamento. Los enlaces profundos de trabajo mantienen
su destino. Pantallas de TV siguen directamente al tablero; cambio obligatorio
de clave mantiene prioridad. Carburacion conserva su sesion limitada a esa area.

El inicio muestra los departamentos reales del sistema. No crea modulos nuevos
ni permisos para los nombres ilustrativos del diseno de referencia. Sin permiso,
el boton se deshabilita y no hay formulario de cambio. El POST de cambio valida
la lista de sesion y consulta de nuevo las asignaciones en base de datos. Ante
error de consulta deniega el cambio. Administracion sigue reservada al propietario.
Se mantienen las protecciones existentes de rol, departamento, sesion y CSRF.
La pantalla de bienvenida no consulta ni expone indicadores de otras areas.

El dashboard existente tiene enlace Inicio empresarial. Menu lateral completo en
escritorio y desplegable en movil, buscador local de departamentos, cierre de
sesion. No hay notificaciones ni indicadores ficticios. No modifica datos SQL.

Prueba de navegador: tests/inicioEmpresa.browser.js. Capturas desktop y movil
en tmp/. Pruebas de permisos y escape de datos: tests/inicioEmpresa.test.js.
