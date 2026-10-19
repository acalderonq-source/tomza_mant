# Mapa de sedes en el inicio empresarial

Reemplaza la ilustracion por Leaflet 1.9.4 con cartografia OpenStreetMap.
El mapa ocupa todo el espacio central bajo la barra superior, sin marco ni
texto de bienvenida alrededor. Conserva el menu de departamentos. La ficha
de fotos aparece superpuesta solo al seleccionar la sede, sin desplazar el mapa.
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

El fondo requiere internet, CDN de Leaflet y disponibilidad de OSM (sin SLA).
Fallback: enlace publico a Bing incluso si falla CDN, tiles o JavaScript.
Atribucion OSM visible; cada tile envia solo origen como Referer, sin modificar
la politica global de seguridad. Sin precarga, descarga offline ni proxy de tiles.
El service worker existente no almacena estas URLs externas.
Revisar proveedor cartografico y sus limites si aumenta el volumen de uso.

Referencias: https://leafletjs.com/examples/quick-start/
https://operations.osmfoundation.org/policies/tiles/
Prueba navegador tests/sedesMapa.browser.js intercepta tiles para no descargar
mapas de OSM mediante automatizacion. Capturas de QA con tiles simulados.
