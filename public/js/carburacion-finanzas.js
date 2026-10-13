(() => {
  document.querySelectorAll('[data-provider-target]').forEach(input => {
    const select=document.getElementById(input.dataset.providerTarget);
    if(!select)return;
    const normalizar=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es-CR');
    input.addEventListener('input',()=>{
      const filtro=normalizar(input.value.trim());
      [...select.options].forEach(option=>{option.hidden=!!option.value && !normalizar(option.textContent).includes(filtro);});
    });
  });
  document.querySelectorAll('.table-facturas').forEach(table => {
    const labels = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach(row => {
      [...row.children].forEach((cell,index) => {
        if (!cell.hasAttribute('colspan')) cell.dataset.label = labels[index] || '';
      });
    });
  });
  const tipo = document.querySelector('[data-pago-tipo]');
  const abono = document.querySelector('[data-abono-campo]');
  const actualizar = () => {
    if (!abono) return;
    abono.hidden = tipo.value !== 'abono';
    abono.querySelector('input').required = !abono.hidden;
  };
  tipo?.addEventListener('change',actualizar);
  if (tipo) actualizar();
  document.querySelectorAll('[data-archivo-form]').forEach(form => {
    let enviado = false;
    form.addEventListener('submit',async event => {
      event.preventDefault();
      if (enviado) return;
      const error = form.querySelector('[data-archivo-error]');
      const file = form.querySelector('[data-archivo-input]')?.files[0];
      error.textContent = '';
      if (file && (!['application/pdf','image/png','image/jpeg'].includes(file.type) || file.size > 5*1024*1024)) {
        error.textContent = 'Seleccione un PDF, PNG o JPG de máximo 5 MB.';
        return;
      }
      enviado = true;
      const button = event.submitter || form.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        if (file) {
          form.querySelector('[data-archivo-data]').value = await new Promise((resolve,reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
            reader.readAsDataURL(file);
          });
          form.querySelector('[data-archivo-nombre]').value = file.name;
        }
        HTMLFormElement.prototype.submit.call(form);
      } catch(e) { error.textContent=e.message; enviado=false; button.disabled=false; }
    });
  });
})();
