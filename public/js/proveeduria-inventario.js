(()=>{
  const articulos=JSON.parse(document.getElementById('inventario-datos').textContent);
  document.getElementById('abrir-nuevo')?.addEventListener('click',()=>{document.getElementById('nuevo-articulo').open=true;});
  document.querySelectorAll('[data-editar-articulo]').forEach(b=>b.addEventListener('click',()=>{
    const a=articulos[Number(b.dataset.editarArticulo)],form=document.getElementById('ficha-form');
    for(const key of ['sede','codigo','descripcion','grupo','tipo','categoria','unidad','ubicacion','stock_minimo','stock_maximo','proveedor','iva'])form.elements[key].value=a[key]??'';
    document.getElementById('ficha-referencia').textContent=`${a.codigo} · ${a.sede} · Existencia: ${a.cantidad} ${a.unidad}`;
    document.getElementById('editar-ficha').showModal();
  }));
  document.querySelectorAll('[data-ajustar-articulo]').forEach(b=>b.addEventListener('click',()=>{
    const a=articulos[Number(b.dataset.ajustarArticulo)],form=document.getElementById('ajuste-form');form.reset();form.elements.sede.value=a.sede;form.elements.codigo.value=a.codigo;form.elements.cantidad.value=a.cantidad;
    document.getElementById('ajuste-referencia').textContent=`${a.descripcion} · ${a.sede}. Existencia registrada: ${a.cantidad} ${a.unidad}`;document.getElementById('ajustar-existencia').showModal();
  }));
  document.querySelectorAll('[data-cerrar-dialog]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
})();
