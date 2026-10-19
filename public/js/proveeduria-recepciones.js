(() => {
  document.getElementById('imprimir-recepcion')?.addEventListener('click',()=>window.print());
  const form=document.getElementById('recepcion-form'),boton=document.getElementById('guardar-recepcion');
  if(!form||!boton)return;
  const inputs=[...form.querySelectorAll('.receipt-quantity:not(:disabled)')],estado=document.getElementById('recepcion-resultado');
  let guardando=false;
  function resumen(){
    const seleccionadas=inputs.filter(i=>Number(i.value)>0);
    const completa=inputs.every(i=>Number(i.value)===Number(i.max));
    document.getElementById('resumen-entrega').textContent=seleccionadas.length?`${seleccionadas.length} artículos en esta entrega. ${completa?'Se completará la recepción de la OC.':'La OC conservará cantidades pendientes.'}`:'Seleccione las cantidades para registrar la entrega.';
  }
  inputs.forEach(i=>i.addEventListener('input',resumen));
  document.getElementById('completar-pendientes')?.addEventListener('click',()=>{inputs.forEach(i=>{i.value=i.max;});document.getElementById('confirmar-mercaderia').checked=false;resumen();});
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(guardando)return;
    if(!inputs.some(i=>Number(i.value)>0)){estado.hidden=false;estado.className='alert alert-warning';estado.textContent='Ingrese al menos una cantidad recibida mayor que cero.';return;}
    guardando=true;boton.disabled=true;estado.hidden=false;estado.className='alert alert-info';estado.textContent='Registrando la recepción…';
    const body=Object.fromEntries(new FormData(form));body.lineas=inputs.map(i=>({codigo:i.dataset.codigo,cantidad:i.value}));
    try{
      const r=await fetch(form.action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(r.redirected){throw Error('Su sesión terminó. Inicie sesión nuevamente antes de confirmar la recepción.');}
      const resultado=await r.json();if(!r.ok)throw Error(resultado.error||'No se pudo registrar la recepción');
      estado.className='alert alert-success';estado.textContent='Recepción guardada correctamente.';
      location.reload();
    }catch(e){estado.className='alert alert-danger';estado.textContent=e.message;estado.tabIndex=-1;estado.focus();guardando=false;boton.disabled=false;}
  });
})();
