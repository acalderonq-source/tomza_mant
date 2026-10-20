document.addEventListener('DOMContentLoaded',()=>{
  const container=document.getElementById('sedes-mapa');
  if(!container)return;
  const status=document.getElementById('mapa-estado');
  if(!window.L){status.textContent='No se pudo cargar el mapa. Puede abrir la ubicacion con el enlace inferior.';return;}
  // Puntos enviados por el usuario; fuentes y precision en docs/mapa-sedes.md.
  const sedes=[
    {nombre:'Cartago',empresa:'Gas Tomza de Costa Rica S.A.',lat:9.877662658691406,lng:-83.94295501708984,direccion:'bottom',fotos:[]},
    {nombre:'La Cruz',empresa:'Planta La Cruz',lat:10.9556471,lng:-85.6148776,enlace:'https://maps.app.goo.gl/L9V28aBZcqjKmWNe7',fotos:[]},
    {nombre:'Orotina',empresa:'Cedi Orotina',lat:9.8928466,lng:-84.645024,direccion:'left',enlace:'https://maps.app.goo.gl/z2LXXTwBxCKScfuN9',fotos:[]},
    {nombre:'Alajuela',empresa:'Planta Alajuela',lat:9.9976714,lng:-84.2403176,direccion:'top',enlace:'https://maps.app.goo.gl/uQgUmrAsLabLxYTH8',fotos:[]},
    {nombre:'Guápiles',empresa:'Cedi Guápiles',lat:10.2024713,lng:-83.77406,enlace:'https://maps.app.goo.gl/Jyk7kmjFGqFEVRuc8',fotos:[]},
    {nombre:'Río Claro',empresa:'Cedi Río Claro',lat:8.6695875,lng:-83.060390625,enlace:'https://maps.app.goo.gl/RTwF4WoedG7FPfbRA',fotos:[]},
    {nombre:'Nicoya',empresa:'Cedi Nicoya',lat:10.1614089,lng:-85.4533432,direccion:'left',enlace:'https://maps.app.goo.gl/efaT7b1NZMkSM9zn9',fotos:[]}
  ];
  const map=L.map(container,{scrollWheelZoom:false,zoomControl:false,fadeAnimation:false,zoomAnimation:false,minZoom:6,maxZoom:11,zoomSnap:.25,zoomDelta:.5});
  const stage=container.closest('.sedes-map-stage');
  const detalle=document.getElementById('sede-detalle'),foto=document.getElementById('sede-foto');
  const fotoEstado=document.getElementById('sede-foto-estado'),controles=document.querySelector('.sede-fotos-controles');
  let seleccion=null,indice=0,alLlegar=null;
  const cancelarAcercamiento=()=>{if(alLlegar){map.off('moveend',alLlegar);alLlegar=null;}map.stop();};
  const mostrarFoto=()=>{
    const fotos=seleccion?.fotos || [];
    foto.hidden=true;fotoEstado.hidden=false;controles.hidden=fotos.length<2;
    if(!fotos.length){foto.removeAttribute('src');fotoEstado.textContent='Todavía no se han agregado fotografías de esta sede.';return;}
    fotoEstado.textContent='Cargando fotografía…';
    foto.alt=fotos[indice].alt || 'Sede Gas Tomza '+seleccion.nombre;
    foto.src=fotos[indice].src;
    document.getElementById('sede-foto-contador').textContent=(indice+1)+' / '+fotos.length;
  };
  foto.addEventListener('load',()=>{foto.hidden=false;fotoEstado.hidden=true;});
  foto.addEventListener('error',()=>{foto.hidden=true;fotoEstado.hidden=false;fotoEstado.textContent='No se pudo cargar esta fotografía.';});
  document.getElementById('sede-foto-anterior').addEventListener('click',()=>{if(seleccion?.fotos.length){indice=(indice-1+seleccion.fotos.length)%seleccion.fotos.length;mostrarFoto();}});
  document.getElementById('sede-foto-siguiente').addEventListener('click',()=>{if(seleccion?.fotos.length){indice=(indice+1)%seleccion.fotos.length;mostrarFoto();}});
  const seleccionar=(sede,marker)=>{
    cancelarAcercamiento();map.closePopup();seleccion=sede;indice=0;detalle.hidden=false;
    marcadores.forEach((m,i)=>m.getElement()?.classList.toggle('sede-seleccionada',sedes[i]===sede));
    document.getElementById('mapa-sede').value=String(sedes.indexOf(sede));
    const ubicacion=document.querySelector('.sedes-footer>a');
    ubicacion.href=sede.enlace || 'https://www.google.com/maps/dir/?api=1&destination='+sede.lat+','+sede.lng;
    ubicacion.setAttribute('aria-label','Ver ubicación de '+sede.nombre);
    document.getElementById('sede-detalle-titulo').textContent=sede.nombre;mostrarFoto();
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches || (map.getZoom()===10 && map.getCenter().distanceTo([sede.lat,sede.lng])<5)){
      map.setView([sede.lat,sede.lng],10,{animate:false});marker.openPopup();return;
    }
    alLlegar=()=>{alLlegar=null;marker.openPopup();};map.once('moveend',alLlegar);
    map.flyTo([sede.lat,sede.lng],10,{duration:1.5});
  };
  document.getElementById('sede-detalle-cerrar').addEventListener('click',()=>{cancelarAcercamiento();detalle.hidden=true;map.closePopup();document.getElementById('mapa-cartago').focus();});
  map.on('popupopen',()=>stage.classList.add('sede-abierta'));
  map.on('popupclose',()=>stage.classList.remove('sede-abierta'));
  const pais=L.latLngBounds([8.03,-85.98],[11.25,-82.5]);
  const verPais=()=>map.fitBounds(pais,{padding:[12,12],animate:false});
  verPais();
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('<a href="https://www.geoboundaries.org/" target="_blank" rel="noopener noreferrer">geoBoundaries</a> · &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>');
  fetch('/data/mapa-sedes/costa-rica-provincias.geojson',{signal:AbortSignal.timeout(15000)})
    .then(response=>{if(!response.ok)throw Error('MAPA_NO_DISPONIBLE');return response.json();})
    .then(data=>{
      if(data.type!=='FeatureCollection' || data.features?.length!==7)throw Error('MAPA_INVALIDO');
      L.geoJSON(data,{style:{color:'#8bb7db',weight:.9,fillColor:'#1156a6',fillOpacity:1},
        onEachFeature:(feature,layer)=>{
          const label=document.createElement('span');label.textContent=String(feature.properties.shapeName || '').replace(/^Provincia /,'');
          layer.bindTooltip(label,{className:'provincia-label',sticky:true});
          layer.on('mouseover',()=>layer.setStyle({fillColor:'#1b68b8'}));
          layer.on('mouseout',()=>layer.setStyle({fillColor:'#1156a6'}));
        }
      }).addTo(map);
      status.textContent='';
    }).catch(()=>{status.textContent='No se pudo cargar la silueta del pais. Puede abrir la ubicacion con el enlace inferior.';});
  const oceanos=[['MAR CARIBE',10.55,-82.7],['OCEANO PACIFICO',8.95,-85.6],['PANAMA',8.35,-82.6]];
  oceanos.forEach(([nombre,lat,lng])=>{
    const label=document.createElement('span');label.textContent=nombre;
    L.marker([lat,lng],{interactive:false,keyboard:false,icon:L.divIcon({className:'mapa-geografia',html:label,iconSize:[140,28],iconAnchor:[70,14]})}).addTo(map);
  });
  const marcadores=sedes.map(sede=>{
    const content=document.createElement('div');
    const name=document.createElement('strong');name.textContent='Gas Tomza · '+sede.nombre;
    const company=document.createElement('span');company.textContent=sede.empresa;
    const br=document.createElement('br'),link=document.createElement('a');
    link.textContent='Como llegar';link.href='https://www.google.com/maps/dir/?api=1&destination='+sede.lat+','+sede.lng;
    link.target='_blank';link.rel='noopener noreferrer';content.append(name,company,br,link);
    const icon=L.divIcon({className:'tomza-map-marker'+(sede===sedes[0]?' sede-seleccionada':''),html:'<span class="sede-mapa-punto"></span>',iconSize:[20,20],iconAnchor:[10,10],popupAnchor:[0,-14]});
    const direccion=sede.direccion || 'right';
    const offset={left:[-15,0],right:[22,0],top:[0,-16],bottom:[0,14]}[direccion];
    const marker=L.marker([sede.lat,sede.lng],{icon,title:'Gas Tomza '+sede.nombre,alt:'Sede Gas Tomza '+sede.nombre})
      .addTo(map).bindTooltip(sede.nombre,{className:'tomza-map-label',permanent:true,direction:direccion,offset}).bindPopup(content,{className:'tomza-popup',maxWidth:260});
    marker.on('click',()=>seleccionar(sede,marker));
    return marker;
  });
  const selector=document.getElementById('mapa-sede');
  sedes.forEach((sede,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=sede.empresa;selector.append(option);});
  selector.disabled=false;
  selector.addEventListener('change',()=>{const i=Number(selector.value);if(selector.value!==''&&sedes[i])seleccionar(sedes[i],marcadores[i]);});
  ['mapa-pais','mapa-cartago','mapa-acercar','mapa-alejar'].forEach(id=>{document.getElementById(id).disabled=false;});
  document.getElementById('mapa-acercar').addEventListener('click',()=>map.zoomIn());
  document.getElementById('mapa-alejar').addEventListener('click',()=>map.zoomOut());
  document.getElementById('mapa-pais').addEventListener('click',()=>{cancelarAcercamiento();detalle.hidden=true;map.closePopup();verPais();});
  document.getElementById('mapa-cartago').addEventListener('click',()=>{
    seleccionar(sedes[0],marcadores[0]);
  });
  if(window.ResizeObserver)new ResizeObserver(()=>map.invalidateSize({pan:false})).observe(container);
});
