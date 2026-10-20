# Noticias en el inicio empresarial

- Administracion > Noticias del inicio (`/admin/noticias`). Solo el propietario, con Administracion activa, puede administrar publicaciones.
- Se pueden subir varias imagenes PNG, JPG o WebP (hasta 4 MB cada una), cambiar titulo y orden, desactivar o eliminar.
- La bienvenida conserva su mapa. Si hay noticias publicadas, alterna cada 10 segundos entre mapa e imagenes. Tiene controles anterior/siguiente, pausa y volver al mapa.
- El avance se detiene al enfocar o interactuar con el carrusel, al tocar el mapa o al ocultar la pestana. Con movimiento reducido comienza pausado.
- Sin publicaciones o si falla la carga de noticias, el mapa sigue disponible.
- Imagenes y metadatos se guardan en MySQL (`inicio_noticias`); no dependen del disco temporal de Render. Las imagenes se incluyen en el respaldo SQL y no son publicas sin una sesion interna.
- Aplicar `202610200001_noticias_inicio.sql` mediante el proceso de migraciones antes de usar la administracion.
- Pruebas: `node --test tests/noticiasInicio.test.js`; prueba visual con Playwright: `node tests/noticiasInicio.browser.js`.
