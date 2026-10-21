# Tomza Mantenimiento

Sistema empresarial de Gas Tomza para mantenimiento, taller, compras, proveeduría, contabilidad y operaciones. Aplicación Node.js con Express, vistas EJS y MySQL; incluye clientes Android y de escritorio.

## Desarrollo local

Utilizar Node.js 22.18.0 (ver `.node-version`) y npm. `package-lock.json` es el archivo de versiones utilizado por CI y Render.

```powershell
npm ci
npm run check:syntax
npm test
npm run dev
```

Antes de iniciar el servidor, configurar el `.env` local con las conexiones e integraciones del entorno de desarrollo. Las credenciales no se versionan. Consultar [la guía de desarrollo](docs/APRENDER_A_PROGRAMAR_EN_TOMZA.md) y [la seguridad del sistema](docs/seguridad-del-sistema.md).

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `src/routes/` | Rutas HTTP y control de las operaciones. |
| `src/services/` | Servicios y procesamiento de informes e integraciones. |
| `src/utils/` | Funciones compartidas y reglas de negocio. |
| `src/middleware/` | Seguridad, sesiones y permisos. |
| `src/views/` | Pantallas y componentes EJS. |
| `src/data/` | Catálogos y datos de referencia necesarios. |
| `src/templates/` | Plantillas originales utilizadas para generar documentos. |
| `src/scripts/` | Herramientas de administración, migración e importación. |
| `public/` | Recursos del navegador y descargas publicadas. |
| `migrations/` | Cambios versionados del esquema SQL. |
| `tests/` | Pruebas automatizadas y verificaciones de navegador. |
| `docs/` | Documentación técnica, funcional y operativa. |
| `android/` | Proyecto del cliente Android. |
| `desktop/` | Cliente Electron; tiene su propio `package.json`. |
| `.github/` | Integración continua. |

`src/server.js` inicia el servidor y `src/db.js` centraliza la conexión a MySQL. Los archivos `render.yaml` y `render.staging.yaml` definen los despliegues.

## Comandos operativos

| Comando | Uso |
| --- | --- |
| `npm start` | Iniciar el servidor. |
| `npm run check:syntax` | Revisar sintaxis JavaScript del servidor y navegador. |
| `npm test` | Ejecutar la suite de pruebas de Node.js. |
| `npm run migrate:plan` | Consultar el plan de migraciones. |
| `npm run migrate` | Aplicar migraciones a la base configurada. |
| `npm run backup:create` | Crear un respaldo según la configuración local. |
| `npm run backup:verify` | Verificar un respaldo. |

Las migraciones, importaciones y herramientas administrativas pueden modificar datos: revisar el entorno de destino antes de ejecutarlas. Para respaldos, seguir [respaldo y restauración](docs/RESPALDO_Y_RESTAURACION.md).

## Documentación

- [Índice de documentación](docs/README.md).
- [Arquitectura empresarial](docs/ARQUITECTURA_EMPRESARIAL.md).
- [Organización y mantenimiento de carpetas](docs/organizacion-repositorio.md).
- [Cliente Android](android/README.md).
- [Cliente de escritorio](desktop/README.md).
