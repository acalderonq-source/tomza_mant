# Edicion de perfiles de acceso

Administracion > Perfiles de acceso permite buscar cuentas y editar nombre y sede sin cambiar credenciales. Tambien hay un enlace desde Accesos y carnets. Solo el propietario conectado al departamento Administracion puede abrir o guardar el editor. Las cuentas ADMIN y las pantallas de taller estan protegidas.

Las cuentas anteriores conservan rol y departamentos por defecto. Elegir explicitamente permisos individuales reemplaza el rol por el rol base del departamento seleccionado, reemplaza los departamentos asignados por ese departamento y guarda permisos de lectura/gestion por modulo. Las restricciones propias del modulo siguen vigentes. No se cambia usuario, cedula, contrasena, PIN ni asociaciones a carnets. Si varias personas usan la cuenta, todas reciben el cambio.

Una cuenta que ya tiene permisos individuales no puede descartarlos desde el editor. El middleware verifica la configuracion actual en cada peticion para cuentas nuevas y anteriores; una cuenta anterior sin configuracion sigue funcionando igual. Cambios de rol, sede o departamentos invalidan las sesiones mediante el sello existente; los cambios de permisos se verifican sin depender del sello.

Los cambios son transaccionales y exigen una huella de la version leida; un conflicto devuelve 409. La tabla usuario_perfiles_historial, creada de forma idempotente, conserva antes/despues, actor y fecha sin almacenar contrasenas ni PIN. No se convierten cuentas automaticamente al desplegar.

Pruebas: node --test tests/perfilesAcceso.test.js tests/accesosTrabajador.test.js
Interfaz: node tests/perfilesAcceso.browser.js
