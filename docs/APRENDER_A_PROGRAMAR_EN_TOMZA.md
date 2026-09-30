# Aprender a programar con el sistema Tomza

## Qué tecnologías usa

- **JavaScript y Node.js:** lógica del servidor.
- **Express:** URLs, formularios y respuestas HTTP.
- **EJS:** pantallas HTML que reciben datos del servidor.
- **MySQL:** almacenamiento de registros.
- **SQL:** consultas y cambios de datos.
- **Git:** historial de cambios y publicación.
- **Pruebas Node.js:** verifican que permisos y reglas sigan funcionando.

## Cómo viaja una operación

Ejemplo: registrar una solicitud de repuesto.

1. El usuario abre una pantalla EJS.
2. El formulario envía un `POST` a Express.
3. Una ruta valida sesión, permiso y datos.
4. La ruta consulta o actualiza MySQL mediante `src/db.js`.
5. El usuario recibe confirmación o un error.
6. Una prueba automatizada comprueba el resultado y los permisos.

## Dónde mirar en el repositorio

- `src/server.js`: configura Express, seguridad y monta las rutas.
- `src/routes/`: recibe las solicitudes web y aplica reglas del proceso.
- `src/views/`: define las pantallas EJS.
- `src/utils/`: contiene funciones compartidas.
- `src/db.js`: configura el pool de conexiones MySQL.
- `migrations/`: cambios versionados de las tablas.
- `tests/`: pruebas automatizadas.
- `render.yaml`: configuración declarativa del despliegue.

## Recorrido sugerido

1. Aprender variables, condiciones, funciones y arreglos de JavaScript.
2. Leer una ruta `GET` y seguir los datos que envía a una vista EJS.
3. Leer un formulario y encontrar su ruta `POST`.
4. Aprender `SELECT`, `INSERT`, `UPDATE` y parámetros `?` de SQL.
5. Entender autenticación, permisos y validación antes de cambiar una ruta.
6. Escribir una prueba para el comportamiento esperado y para un acceso denegado.
7. Aprender Git: revisar `git diff`, guardar solo los archivos propios y publicar cambios pequeños.

## Comandos de desarrollo

Desde PowerShell, en la carpeta del repositorio:

```powershell
npm ci
npm run dev
```

En otra ventana de PowerShell, las pruebas se ejecutan con:

```powershell
npm test
```

El servidor necesita variables locales de conexión MySQL. Usa una base de pruebas y credenciales de desarrollo; no copies secretos de producción a un archivo, mensaje o repositorio. `.env` está excluido de Git.

## Primer ejercicio seguro

Antes de cambiar una función empresarial, sigue un flujo que ya existe, por ejemplo el alta de una solicitud de repuesto. Anota:

- Qué pantalla envía el formulario.
- Qué ruta recibe el `POST`.
- Qué campos valida.
- Qué tabla modifica.
- Qué permiso exige.
- Qué prueba cubre el resultado.

Luego haz un cambio pequeño solo en una rama de trabajo, agrega o actualiza una prueba y revisa `git diff`. No experimentes sobre la base de producción ni cambies migraciones que ya fueron ejecutadas: crea una migración nueva.

## Cómo trabajaremos para que aprendas

En cada cambio te explicaré: **qué archivo hace qué**, **qué problema resuelve**, **cómo probarlo** y **qué conceptos de programación aparecen**. Podemos avanzar de una función pequeña a otra; no necesitas aprender todo JavaScript antes de entender una parte real del sistema.
