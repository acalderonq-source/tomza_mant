# Mapa de sedes en el inicio empresarial

Mapa vectorial ilustrado con Leaflet 1.9.4 y geometria local geoBoundaries.
Conserva la bienvenida y el menu de departamentos. Silueta azul, divisiones
provinciales, fondo claro y punto seleccionado naranja con anillos, siguiendo
la referencia del usuario. No utiliza mosaicos de calles ni imagen estatica.
Una sede inicial: Cartago, Gas Tomza de Costa Rica S.A., coordenadas del enlace
de Bing entregado por el usuario: 9.877662658691406, -83.94295501708984.
No se geocodifico ni se supusieron direcciones de las demas sedes.

Al tocar el marcador o la sede, flyTo acerca al punto en 1.5 segundos y abre la
ficha con galeria. Respeta prefers-reduced-motion. Fotos en sedes[].fotos con
src local y alt descriptivo; inicialmente vacio porque el usuario aun no ha
entregado fotografias de Cartago. No se usan fotos generadas ni de otra sede.
Controles anterior/siguiente, error de imagen y cierre disponibles. La prueba
de galeria usa imagen de marca solo como fixture, no como foto de la sede.

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
sigue disponible si falla la geometria, CDN o JavaScript.

Referencias: https://leafletjs.com/examples/quick-start/
https://www.geoboundaries.org/api/current/gbOpen/CRI/ADM1/
Prueba navegador tests/sedesMapa.browser.js utiliza la geometria local real.
