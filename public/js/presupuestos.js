document.querySelectorAll('[data-excel-form]').forEach(form=>{
  form.addEventListener('submit',async event=>{
    if(form.dataset.preparado==='1')return;
    event.preventDefault();const input=form.querySelector('input[type=file]'),file=input.files[0],estado=form.querySelector('[role=status]');
    if(!file)return;
    if(file.size>5*1024*1024){estado.textContent='El archivo supera 5 MB.';return;}
    const boton=form.querySelector('button[type=submit]');boton.disabled=true;estado.textContent='Preparando vista previa…';
    try{const reader=new FileReader();const data=await new Promise((resolve,reject)=>{reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});form.querySelector('[name=archivo]').value=data.split(',')[1];form.dataset.preparado='1';boton.disabled=false;form.requestSubmit();}
    catch(_error){boton.disabled=false;estado.textContent='No se pudo leer el archivo. Vuelva a seleccionarlo.';}
  });
});
