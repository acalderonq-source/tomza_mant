# Mapa de sedes en el inicio empresarial

Mapa vectorial ilustrado con Leaflet 1.9.4 y geometria local geoBoundaries.
Conserva la bienvenida y el menu de departamentos. Silueta azul, divisiones
provinciales, fondo claro y punto seleccionado naranja con anillos, siguiendo
la referencia del usuario. No utiliza mosaicos de calles ni imagen estatica.

Al tocar el marcador o elegir una sede, flyTo acerca al punto en 1.5 segundos
y abre la ficha con galeria. Respeta prefers-reduced-motion. Fotos en
sedes[].fotos con src local y alt descriptivo; no se usan fotos generadas ni
de otra sede. Controles anterior/siguiente, error de imagen y cierre
disponibles. La prueba de galeria usa imagen de marca solo como fixture.

Zoom y desplazamiento, vista pais, boton para centrar Cartago, popup y enlace
Como llegar. La lista ampliable esta en public/js/sedes-mapa.js. El mapa no
otorga acceso a modulos ni expone datos operativos; los permisos no cambian.
No usa geolocalizacion del dispositivo ni requiere claves o tarjeta de mapas.

Geometria: public/data/mapa-sedes/costa-rica-provincias.geojson, siete provincias,
fuente geoBoundaries/OpenStreetMap bajo ODbL. Procedencia y licencia junto al
archivo. No se modifican geometrias. El viewport inicial muestra el territorio
continental; las islas remotas originales se conservan en los datos.
Requiere CDN de Leaflet y el servidor de la aplicacion para cargar GeoJSON;
no solicita tiles a proveedores externos. Atribucion visible. El enlace a Bing
inicial sigue disponible si falla la geometria, CDN o JavaScript.

Referencias: https://leafletjs.com/examples/quick-start/
https://www.geoboundaries.org/api/current/gbOpen/CRI/ADM1/
Prueba navegador tests/sedesMapa.browser.js utiliza la geometria local real.

## Ubicaciones confirmadas por el propietario

Ubicaciones enviadas por el propietario el 19 de octubre de 2026. No se buscaron sedes por coincidencia de nombres ni se agregaron fotografias de terceros. Cartago conserva su punto de Bing previamente confirmado: 9.877662658691406, -83.94295501708984.

| Sede indicada | Enlace proporcionado | Latitud | Longitud |
| --- | --- | --- | --- |
| Planta La Cruz | https://maps.app.goo.gl/L9V28aBZcqjKmWNe7 | 10.9556471 | -85.6148776 |
| Cedi Orotina | https://maps.app.goo.gl/z2LXXTwBxCKScfuN9 | 9.8928466 | -84.645024 |
| Planta Alajuela | https://maps.app.goo.gl/uQgUmrAsLabLxYTH8 | 9.9976714 | -84.2403176 |
| Cedi Guapiles | https://maps.app.goo.gl/Jyk7kmjFGqFEVRuc8 | 10.2024713 | -83.77406 |
| Cedi Rio Claro | https://maps.app.goo.gl/RTwF4WoedG7FPfbRA | 8.6695875 | -83.060390625 |
| Cedi Nicoya | https://maps.app.goo.gl/efaT7b1NZMkSM9zn9 | 10.1614089 | -85.4533432 |

Cinco enlaces se expandieron mediante su respuesta HTTP Location de Google Maps; las coordenadas proceden de los campos !3d y !4d. El punto de Guapiles se referencia como Cementos Progreso en Google, pero el nombre de sede es el indicado por el propietario.

Rio Claro se referencia como Bimbo Rio Claro y no expone coordenadas en la redireccion. Se uso el codigo corto MW9Q+RRQ contenido en el enlace, recuperado como 66WRMW9Q+RRQ con Open Location Code (implementacion de Google, paquete temporal open-location-code). Referencia regional verificada en OpenStreetMap/Nominatim: pueblo Rio Claro, Guaycara, Golfito, 8.6794934,-83.0655999. Se almacena el centro del area codificada, no el centro del pueblo: limites 8.669575..8.6696 y -83.06040625..-83.060375. No se usa el centro generico de Costa Rica que devolvio la pagina HTML de Google al no resolver ese lugar.

La herramienta de decodificacion se uso solo para verificar el punto; no se agregaron paquetes al proyecto. El mapa conserva las siete provincias locales, seleccion unica, acercamiento animado, enlaces de indicaciones y vista de fotografias pendiente. No cambia permisos ni tablas de sedes operativas.
