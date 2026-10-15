(() => {
  const resultado=document.getElementById('resultado');
  const aviso=(mensaje,error=false)=>{resultado.className=`alert alert-${error?'danger':'success'}`;resultado.textContent=mensaje;resultado.scrollIntoView({block:'nearest',behavior:'smooth'});};
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
    const q=normalizar(document.querySelector('[data-buscar]')?.value||''),responsable=document.querySelector('[data-responsable-filtro]')?.value||'';let visibles=0;
    const filas=document.querySelectorAll('[data-factura]');
    filas.forEach(row=>{const estado=filtro==='todas'||(filtro==='excepciones'?row.dataset.excepcion==='1':filtro==='vencidas'?row.dataset.vencida==='1':filtro==='atrasadas'?row.dataset.atrasada==='1':filtro==='sin-orden'?row.dataset.sinOrden==='1':row.dataset.invoiceState===filtro);const asignado=!responsable||(responsable==='sin-asignar'?!row.dataset.responsable:row.dataset.responsable===responsable);row.hidden=!(normalizar(row.textContent).includes(q)&&estado&&asignado);if(!row.hidden)visibles++;});
    const vacio=document.querySelector('[data-sin-resultados]');if(vacio)vacio.hidden=visibles>0||filas.length===0;
    const contador=document.querySelector('[data-invoice-results]');if(contador)contador.textContent=`${visibles} documentos`;
  }
  document.querySelector('[data-buscar]')?.addEventListener('input',filtrar);
  document.querySelector('[data-responsable-filtro]')?.addEventListener('change',filtrar);
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
  const ordenes=document.querySelector('[data-ordenes-proveedor]');
  if(ordenes){
    const avisoOrdenes=document.querySelector('[data-ordenes-aviso]'),lista=document.querySelector('[data-lista-ordenes]');
    async function cargarOrdenes(){
      try{
        const r=await fetch('/portal-proveedores/ordenes');if(r.redirected){location.assign(r.url);return;}if(!r.ok)throw Error('No se pudieron cargar las órdenes');
        const j=await r.json();
        avisoOrdenes.textContent=j.ordenes.length?'Seleccione una orden o conserve la búsqueda automática.':'No hay órdenes disponibles con su cédula fiscal. Puede presentar la factura para revisión.';
        for(const o of j.ordenes){
          const monto=Number(o.disponible).toLocaleString('es-CR',{style:'currency',currency:o.moneda});
          const texto=`${o.numero} · ${o.origen==='COMPRAS'?'Taller / Compras':'Proveeduría'} · ${o.empresa||'Empresa por confirmar'} · Disponible ${monto}`;
          const option=document.createElement('option');option.value=`${o.origen}:${o.id}`;option.textContent=texto;ordenes.append(option);
          const fila=document.createElement('div');fila.className='d-flex flex-wrap justify-content-between gap-2 border-bottom py-2';const detalle=document.createElement('span');detalle.textContent=texto;const elegir=document.createElement('button');elegir.type='button';elegir.className='btn btn-sm btn-outline-primary';elegir.textContent='Usar esta orden';elegir.addEventListener('click',()=>{ordenes.value=option.value;ordenes.dispatchEvent(new Event('change'));document.getElementById('nueva-factura').scrollIntoView({behavior:'smooth'});});fila.append(detalle,elegir);lista.append(fila);
        }
        if(!j.ordenes.length)lista.textContent=avisoOrdenes.textContent;
      }catch(e){avisoOrdenes.textContent=e.message+'. Puede usar la búsqueda automática al presentar la factura.';lista.textContent=avisoOrdenes.textContent;}
    }
    cargarOrdenes();
    const xml=document.querySelector('#xml'),panel=document.createElement('div');panel.className='small mt-3';panel.setAttribute('aria-live','polite');ordenes.parentElement.append(panel);
    let revision=0;
    async function validar(){
      const actual=++revision;if(!xml.files[0]){panel.textContent='';return;}
      panel.textContent='Validando XML…';
      try{
        const body={xml:await archivo(xml.files[0],2),orden:ordenes.value};
        const r=await fetch('/portal-proveedores/validar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        if(r.redirected){location.assign(r.url);return;}const j=await r.json();if(actual!==revision)return;if(!r.ok)throw Error(j.error||'No se pudo validar');
        panel.className='alert alert-'+(j.diferencias.length?'warning':'success')+' mt-3';panel.textContent=`Factura ${j.numero} · ${j.empresa} · ${Number(j.total).toLocaleString('es-CR',{style:'currency',currency:j.moneda})}. `+(j.diferencias.length?'Requiere revisión: '+j.diferencias.join('; '):'Identidad y duplicados verificados. La aceptación de Hacienda se consulta por separado.');
      }catch(e){if(actual===revision){panel.className='alert alert-danger mt-3';panel.textContent=e.message;}}
    }
    xml.addEventListener('change',validar);ordenes.addEventListener('change',validar);
  }
})();
