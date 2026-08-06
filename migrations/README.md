# Migraciones de base de datos

Ejecute las migraciones con:

```bash
npm run migrate
```

Reglas:

- Crear un archivo nuevo por cada cambio de estructura.
- Usar nombres con fecha y consecutivo, por ejemplo `202608060002_agregar_campo_facturas.sql`.
- No agregar nuevos `ALTER TABLE` dentro de rutas o vistas.
- Probar primero en una copia o respaldo de la base.

