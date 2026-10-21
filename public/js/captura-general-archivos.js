(()=>{
  const byId=id=>document.getElementById(id),base='/admin/ventas-gas/captura-general/archivos';
  const fmt=value=>value==null?'—':Number(value).toLocaleString('es-CR',{minimumFractionDigits:2,maximumFractionDigits:2});
  let state=JSON.parse(byId('capture-file-state').textContent),busy=false;
  function table(id,rows){const body=byId(id);body.replaceChildren();for(const cells of rows){const row=document.createElement('tr');for(const value of cells){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}body.append(row);}}
  function render(value){
    state=value;
    const period=byId('capture-period');period.replaceChildren();for(const month of state.periods){const option=document.createElement('option');option.value=month;option.textContent=month;option.selected=month===state.period;period.append(option);}
    for(const [id,key]of [['kg','totalKg'],['gross','totalGross'],['discount','totalDiscount'],['net','totalNet']])byId('capture-'+id).textContent=state.period?fmt(state[key]):'—';
    const link=byId('capture-download');link.classList.toggle('d-none',!state.period);link.href=base+'/excel?period='+encodeURIComponent(state.period||'');
    const daysLink=byId('capture-download-days');daysLink.classList.toggle('d-none',!state.period);daysLink.href=base+'/dias.zip?period='+encodeURIComponent(state.period||'');
    byId('capture-updated').textContent=state.updatedAt?'Última carga: '+new Date(state.updatedAt).toLocaleString('es-CR',{timeZone:'America/Costa_Rica'}):'';
    const days=byId('capture-days');days.replaceChildren();for(const d of state.days){const row=document.createElement('tr');for(const value of [d.day,d.origin,fmt(d.kg),fmt(d.gross),fmt(d.discount),fmt(d.net),d.documents||'—',d.captureFiles||'—',d.portfolioEntries||'—']){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}const action=document.createElement('td');if(d.kg!==null||d.captureFiles||d.portfolioEntries){const download=document.createElement('a');download.className='btn btn-sm btn-outline-primary';download.textContent='Descargar originales';download.href=base+'/excel-dia?day='+encodeURIComponent(d.day);action.append(download);}else action.textContent='—';row.append(action);days.append(row);}
    table('capture-differences',state.differences.slice(0,200).map(d=>[d.day,d.field,fmt(d.expected),fmt(d.actual),d.source]));
    byId('capture-comparison').textContent=state.differences.length?`${state.differences.length} diferencias para revisar. Se muestran hasta 200; el Excel incluye todas.`:'No se encontraron diferencias entre los datos comparables adjuntos.';
    const sources=byId('capture-sources');sources.replaceChildren();for(const file of state.files){const li=document.createElement('li');li.textContent=file.filename;sources.append(li);}
    byId('capture-duplicates').textContent=`Última carga: ${state.duplicates} filas repetidas omitidas.`+(state.ignored?.length?' Machotes sin ventas omitidos: '+state.ignored.join(', '):'');
  }
  function error(message){const box=byId('capture-error');box.textContent=message;box.classList.toggle('d-none',!message);}
  async function json(url,options){const response=await fetch(url,options);const result=await response.json().catch(()=>({error:'El servidor no pudo procesar la solicitud.'}));if(!response.ok)throw new Error(result.error||'No se pudo completar la operación.');return result;}
  const read=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('No se pudo leer '+file.name));reader.onload=()=>resolve({filename:file.name,content:String(reader.result).split(',')[1]});reader.readAsDataURL(file);});
  byId('capture-upload').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;error('');const files=[...byId('capture-files').files];
    if(!files.length||files.length>10||files.reduce((sum,f)=>sum+f.size,0)>6*1024*1024){error('Seleccioná hasta 10 archivos con un máximo total de 6 MB.');return;}
    busy=true;byId('capture-submit').disabled=true;byId('capture-period').disabled=true;byId('capture-progress').textContent='Leyendo y completando los días…';
    try{const value=await json(base+'/importar',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':document.querySelector('meta[name="csrf-token"]').content},body:JSON.stringify({revision:state.revision,files:await Promise.all(files.map(read))})});render(value);byId('capture-files').value='';byId('capture-progress').textContent='Captura actualizada.';}
    catch(e){error(e.message);byId('capture-progress').textContent='';if(e.message.includes('Recargá'))try{render(await json(base+'/api'));}catch{}}
    finally{busy=false;byId('capture-submit').disabled=false;byId('capture-period').disabled=false;}
  });
  byId('capture-period').addEventListener('change',async()=>{if(busy)return;error('');try{render(await json(base+'/api?period='+encodeURIComponent(byId('capture-period').value)));}catch(e){error(e.message);}});
  render(state);
})();
