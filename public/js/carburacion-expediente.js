(() => {
 const MAX=3*1024*1024;
 const read=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('No se pudo leer el archivo.'));reader.readAsDataURL(file);});
 document.querySelectorAll('form[data-archivo-form]').forEach(form=>{
  let listo=false,ocupado=false;
  const representante=form.querySelector('[name="representante_legal"]');
  if(representante){
   const actualizar=()=>form.querySelectorAll('[data-legal-registrado]').forEach(input=>{input.required=Boolean(representante.value.trim()) && (representante.value.trim()!==input.dataset.representante || input.dataset.legalRegistrado!=='1');});
   representante.addEventListener('input',actualizar);actualizar();
  }
  form.addEventListener('submit',async event=>{
   if(listo)return;
   event.preventDefault();if(ocupado)return;ocupado=true;const error=form.querySelector('[data-archivo-error]');const button=form.querySelector('button[type="submit"]');
   try{
    error.hidden=true;if(button)button.disabled=true;
    for(const input of form.querySelectorAll('input[type="file"][data-archivo]')){
     const file=input.files?.[0];const prefix=input.dataset.archivo;
     for(const hidden of form.querySelectorAll(`input[data-archivo-campo="${prefix}"]`))hidden.remove();
     if(!file)continue;
     if(file.size>MAX)throw new Error('Cada archivo debe pesar como máximo 3 MB.');
     if(!['application/pdf','image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Seleccione archivos PDF, JPG, PNG o WEBP.');
     const values={[prefix+'_data']:await read(file),[prefix+'_nombre']:file.name};
     for(const [name,value] of Object.entries(values)){const field=document.createElement('input');field.type='hidden';field.name=name;field.value=value;field.dataset.archivoCampo=prefix;form.appendChild(field);}
    }
    listo=true;if(button)button.disabled=false;form.requestSubmit();
   }catch(e){error.textContent=e.message;error.hidden=false;if(button)button.disabled=false;}finally{ocupado=false;}
  });
 });
})();
