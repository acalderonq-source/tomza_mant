(() => {
  const resultado=document.getElementById('resultado');
  const aviso=(mensaje,error=false)=>{resultado.className=`alert alert-${error?'danger':'success'}`;resultado.textContent=mensaje;};
  async function archivo(file,max){if(!file||file.size>max*1024*1024)throw Error(`Seleccione un archivo de hasta ${max} MB`);return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(Error('No se pudo leer el archivo'));r.onload=()=>resolve({nombre:file.name,base64:r.result.split(',')[1]});r.readAsDataURL(file);});}
  document.querySelectorAll('[data-portal-api]').forEach(form=>form.addEventListener('submit',async e=>{
    e.preventDefault();const btn=form.querySelector('button');btn.disabled=true;
    try{
      const body=Object.fromEntries(new FormData(form));
      if(form.querySelector('[data-portal-xml]'))body.xml=await archivo(form.querySelector('[data-portal-xml]').files[0],2);
      if(form.querySelector('[data-portal-archivo]'))body.archivo=await archivo(form.querySelector('[data-portal-archivo]').files[0],5);
      aviso('Procesando…');
      const r=await fetch(form.dataset.portalApi,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(r.redirected){location.assign(r.url);return;}
      const tipo=r.headers.get('content-type')||'';
      const j=tipo.includes('application/json')?await r.json():{error:await r.text()};
      if(!r.ok)throw Error(j.error||'No se pudo completar la operación');
      if(j.redirect)location.assign(j.redirect);else location.reload();
    }catch(error){aviso(error.message,true);btn.disabled=false;}
  }));
  let filtro='todas';
  const normalizar=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function filtrar(){
    const q=normalizar(document.querySelector('[data-buscar]')?.value||'');let visibles=0;
    const filas=document.querySelectorAll('[data-factura]');
    filas.forEach(row=>{row.hidden=!(normalizar(row.textContent).includes(q)&&(filtro==='todas'||(filtro==='excepciones'?row.dataset.excepcion==='1':row.dataset.invoiceState===filtro)));if(!row.hidden)visibles++;});
    const vacio=document.querySelector('[data-sin-resultados]');if(vacio)vacio.hidden=visibles>0||filas.length===0;
    const contador=document.querySelector('[data-invoice-results]');if(contador)contador.textContent=`${visibles} documentos`;
  }
  document.querySelector('[data-buscar]')?.addEventListener('input',filtrar);
  document.querySelectorAll('[data-filter-state]').forEach(button=>button.addEventListener('click',()=>{
    filtro=button.dataset.filterState;
    document.querySelectorAll('[data-filter-state]').forEach(b=>{const activo=b===button;b.classList.toggle('active',activo);b.setAttribute('aria-pressed',String(activo));});filtrar();
  }));
  document.querySelectorAll('[data-document-drop]').forEach(zone=>{
    const input=zone.querySelector('input[type="file"]'),nombre=zone.querySelector('[data-file-name]');
    const actualizar=()=>{const file=input.files[0];zone.classList.toggle('selected',!!file);nombre.textContent=file?file.name+' · '+(file.size/1024).toFixed(0)+' KB':'Sin archivo seleccionado';};
    input.addEventListener('change',actualizar);
    zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('dragging');});
    zone.addEventListener('dragleave',()=>zone.classList.remove('dragging'));
    zone.addEventListener('drop',e=>{
      e.preventDefault();zone.classList.remove('dragging');
      const files=e.dataTransfer.files,extension=input.hasAttribute('data-portal-xml')?'xml':'pdf',max=extension==='xml'?2:5;
      if(files.length!==1||!files[0].name.toLowerCase().endsWith('.'+extension)){aviso('Seleccione un único archivo '+extension.toUpperCase(),true);return;}
      if(files[0].size>max*1024*1024){aviso(`El archivo debe ser de hasta ${max} MB`,true);return;}
      input.files=files;input.dispatchEvent(new Event('change',{bubbles:true}));
    });
  });
})();
