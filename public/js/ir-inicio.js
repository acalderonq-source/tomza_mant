document.addEventListener('DOMContentLoaded',()=>{
  if(location.pathname.replace(/\/+$/,'')==='/inicio')return;
  const salidas=document.querySelectorAll('a[href="/logout"],form[action="/logout"]');
  salidas.forEach(salida=>{
    if(salida.closest('.empresa-session-actions'))return;
    const region=salida.closest('header,.navbar,nav,footer') || salida.parentElement;
    const existente=region.querySelector('a[href="/inicio"]');
    const inicio=existente || document.createElement('a');
    inicio.href='/inicio';inicio.textContent='Ir a inicio';
    inicio.className='empresa-home-link';
    const grupo=document.createElement('div');
    grupo.className='empresa-session-actions';
    salida.before(grupo);grupo.append(inicio,salida);
  });
});
