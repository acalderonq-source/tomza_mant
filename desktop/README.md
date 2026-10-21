# Gas Tomza Sistema para Windows

Este instalador crea un cliente de escritorio que abre el portal general de departamentos en una ventana propia. Los datos, permisos y sesiones siguen administrados por el servidor central `tomza-mant.onrender.com`; la aplicacion requiere conexion a internet y no guarda una base de datos independiente en la computadora.

## Crear instalador

Desde la carpeta del proyecto:

```powershell
npm install --prefix desktop
npm run package:win --prefix desktop
```

El instalador Windows x64 se crea en `desktop/release/`.

## Publicacion

El cliente carga la version vigente del sistema desde el servidor. Las actualizaciones normales del sistema se publican en el servidor y no requieren reinstalar el cliente. Un cambio futuro en la ventana o en sus funciones de escritorio requiere generar y distribuir un nuevo instalador.

El instalador inicial no esta firmado digitalmente. Para distribuirlo ampliamente en la empresa, TI debe firmarlo con el certificado de codigo de Gas Tomza y validarlo con las politicas de seguridad de Windows.
