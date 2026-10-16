(() => {
  const catalogo=JSON.parse(document.getElementById('catalogo-excel-datos').textContent),normal=s=>String(s||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ');
  const buscar=descripcion=>catalogo.find(a=>normal(a.descripcion)===normal(descripcion));
  const tbody=document.querySelector('#itemsTable tbody'),aviso=document.getElementById('catalogoAviso');
  function preparar(row,reemplazar=false){
    const descripcion=row.querySelector('[name*="[descripcion]"]'),precio=row.querySelector('.precio'),a=buscar(descripcion.value);
    row.dataset.iva=a?.iva??row.dataset.iva??13;
    row.querySelector('.iva-articulo').textContent=`IVA automático: ${row.dataset.iva}%`;
    if(a&&(reemplazar||precio.value==='')){
      precio.value=a.precio_unitario??'';
      precio.dataset.excel=precio.value;
      aviso.textContent=a.precio_unitario===null?'Este artículo no tiene precio definido en el Excel. Ingréselo manualmente.':'';
    }
    row.querySelector('.subtotal').value=(Number(row.querySelector('.cantidad').value||0)*Number(precio.value||0)).toFixed(2);
    updateTotals();
  }
  tbody.querySelectorAll('tr').forEach(row=>preparar(row));
  new MutationObserver(records=>records.forEach(r=>r.addedNodes.forEach(row=>{if(row.nodeType===1&&row.matches('tr'))preparar(row);}))).observe(tbody,{childList:true});
  tbody.addEventListener('input',e=>{
    if(e.target.name?.includes('[descripcion]')){
      const row=e.target.closest('tr');row.dataset.iva=buscar(e.target.value)?.iva??13;
      preparar(row,Boolean(buscar(e.target.value)));
    }
    if(e.target.classList.contains('precio'))delete e.target.dataset.excel;
  });
  const dias=document.querySelector('[name="credito"]'),forma=document.querySelector('[name="forma_pago"]');
  dias.addEventListener('input',()=>{if(dias.value!=='')forma.value=Number(dias.value)>0?'Crédito':'Contado';});
  forma.addEventListener('change',()=>{if(normal(forma.value).includes('CONTADO'))dias.value='0';else if(normal(forma.value).includes('CREDITO')&&Number(dias.value)===0)dias.value='';});
  const empresa=document.querySelector('[name="empresa_destino"]');
  const color=()=>document.body.classList.toggle('oc-supergas',empresa.value==='SUPER GAS');empresa.addEventListener('change',color);color();
  document.getElementById('ordenForm').addEventListener('submit',e=>{
    const incompleto=[...tbody.querySelectorAll('.precio')].find(p=>p.value==='');
    if(incompleto){e.preventDefault();incompleto.setCustomValidity('Indique el precio unitario del artículo');incompleto.reportValidity();incompleto.addEventListener('input',()=>incompleto.setCustomValidity(''),{once:true});}
  });
})();
