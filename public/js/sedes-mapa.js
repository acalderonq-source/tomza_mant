document.addEventListener('DOMContentLoaded',()=>{
  const container=document.getElementById('sedes-mapa');
  if(!container)return;
  const status=document.getElementById('mapa-estado');
  if(!window.L){status.textContent='No se pudo cargar el mapa. Puede abrir la ubicacion con el enlace inferior.';return;}
  // Coordenadas proporcionadas por el usuario en el enlace de Bing; sede confirmada como Cartago.
  const sedes=[{nombre:'Cartago',empresa:'Gas Tomza de Costa Rica S.A.',lat:9.877662658691406,lng:-83.94295501708984}];
  const map=L.map(container,{scrollWheelZoom:false,zoomControl:false,fadeAnimation:false,minZoom:5,maxZoom:18});
  const stage=container.closest('.sedes-map-stage');
  map.on('popupopen',()=>stage.classList.add('sede-abierta'));
  map.on('popupclose',()=>stage.classList.remove('sede-abierta'));
  const pais=L.latLngBounds([8.03,-85.98],[11.25,-82.5]);
  const verPais=()=>map.fitBounds(pais,{padding:[12,12],animate:false});
  verPais();
  let cargadas=0;
  const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,referrerPolicy:'origin',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
  });
  tiles.on('loading',()=>{cargadas=0;status.textContent='Cargando mapa…';});
  tiles.on('tileload',()=>{cargadas++;status.textContent='';});
  tiles.on('load',()=>{status.textContent=cargadas?'':'No se pudo cargar el fondo del mapa. La ubicacion de Cartago sigue disponible.';});
  tiles.addTo(map);
  const marcadores=sedes.map(sede=>{
    const content=document.createElement('div');
    const name=document.createElement('strong');name.textContent='Gas Tomza · '+sede.nombre;
    const company=document.createElement('span');company.textContent=sede.empresa;
    const br=document.createElement('br'),link=document.createElement('a');
    link.textContent='Como llegar';link.href='https://www.google.com/maps/dir/?api=1&destination='+sede.lat+','+sede.lng;
    link.target='_blank';link.rel='noopener noreferrer';content.append(name,company,br,link);
    const icon=L.divIcon({className:'tomza-map-marker',html:'<span class="tomza-pin"><img src="/img/logo_tomza.jpg" alt=""></span>',iconSize:[48,56],iconAnchor:[24,56],popupAnchor:[0,-48]});
    const marker=L.marker([sede.lat,sede.lng],{icon,title:'Gas Tomza Cartago',alt:'Sede Gas Tomza Cartago'})
      .addTo(map).bindTooltip(sede.nombre,{className:'tomza-map-label',permanent:true,direction:'bottom',offset:[0,0]}).bindPopup(content,{className:'tomza-popup',maxWidth:260});
    return marker;
  });
  ['mapa-pais','mapa-cartago','mapa-acercar','mapa-alejar'].forEach(id=>{document.getElementById(id).disabled=false;});
  document.getElementById('mapa-acercar').addEventListener('click',()=>map.zoomIn());
  document.getElementById('mapa-alejar').addEventListener('click',()=>map.zoomOut());
  document.getElementById('mapa-pais').addEventListener('click',()=>{map.closePopup();verPais();});
  document.getElementById('mapa-cartago').addEventListener('click',()=>{
    map.setView([sedes[0].lat,sedes[0].lng],14,{animate:false});marcadores[0].openPopup();
  });
  if(window.ResizeObserver)new ResizeObserver(()=>map.invalidateSize({pan:false})).observe(container);
});
