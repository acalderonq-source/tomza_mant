document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('[data-departamento-acceso]').forEach(select=>{
    const form=select.closest('form');
    const actualizar=()=>form.querySelectorAll('[data-areas]').forEach(row=>{
      const permitido=row.dataset.areas.split(',').includes(select.value);
      row.hidden=!permitido;row.querySelector('select').disabled=!permitido;
      const campo=row.querySelector('select');
      if(!permitido)campo.value=[...campo.options].some(o=>o.value==='NINGUNO')?'NINGUNO':'';
    });
    select.addEventListener('change',actualizar);actualizar();
  });
});
