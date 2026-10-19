document.addEventListener('DOMContentLoaded',()=>{
  const container=document.getElementById('sedes-mapa');
  if(!container)return;
  const status=document.getElementById('mapa-estado');
  if(!window.L){status.textContent='No se pudo cargar el mapa. Puede abrir la ubicacion con el enlace inferior.';return;}
  // Coordenadas proporcionadas por el usuario en el enlace de Bing; sede confirmada como Cartago.
  const sedes=[{nombre:'Cartago',empresa:'Gas Tomza de Costa Rica S.A.',lat:9.877662658691406,lng:-83.94295501708984}];
  const map=L.map(container,{scrollWheelZoom:false,minZoom:5,maxZoom:18});
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
    const marker=L.circleMarker([sede.lat,sede.lng],{radius:9,color:'#173b5d',weight:3,fillColor:'#ffd328',fillOpacity:1})
      .addTo(map).bindTooltip(sede.nombre,{permanent:true,direction:'top',offset:[0,-10]}).bindPopup(content);
    return marker;
  });
  document.getElementById('mapa-pais').addEventListener('click',()=>{map.closePopup();verPais();});
  document.getElementById('mapa-cartago').addEventListener('click',()=>{
    map.setView([sedes[0].lat,sedes[0].lng],14,{animate:false});marcadores[0].openPopup();
  });
  if(window.ResizeObserver)new ResizeObserver(()=>map.invalidateSize({pan:false})).observe(container);
});
