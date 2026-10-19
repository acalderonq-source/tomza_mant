document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('[data-departamento-acceso]').forEach(select=>{
    const form=select.closest('form');
    const actualizar=()=>form.querySelectorAll('[data-areas]').forEach(row=>{
      const permitido=row.dataset.areas.split(',').includes(select.value);
      row.hidden=!permitido;row.querySelector('select').disabled=!permitido;
      if(!permitido)row.querySelector('select').value='NINGUNO';
    });
    select.addEventListener('change',actualizar);actualizar();
  });
});
