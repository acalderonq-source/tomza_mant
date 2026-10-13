(() => {
  const buscar=document.getElementById('buscar');
  const filas=[...document.querySelectorAll('[data-proveedor]')];
  const filtros=[...document.querySelectorAll('[data-filtro]')];
  const normalizar=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  let filtro='todos';
  const indice=filas.map(fila=>({fila,texto:normalizar(fila.dataset.buscar)}));
  function actualizar(){
    const texto=normalizar(buscar.value.trim());let visibles=0;
    for(const {fila,texto:contenido} of indice){const coincide=filtro==='todos'||(filtro==='pendientes'?fila.dataset.pendiente==='si':fila.dataset.pago===filtro);fila.hidden=!coincide||!contenido.includes(texto);if(!fila.hidden)visibles++;}
    document.getElementById('cantidad-resultados').textContent=`${visibles} ${visibles===1?'proveedor':'proveedores'}${visibles!==filas.length?' de '+filas.length:''}`;
    document.getElementById('sin-resultados').hidden=visibles>0;
    filtros.forEach(b=>{const activo=b.dataset.filtro===filtro;b.classList.toggle('active',activo);b.setAttribute('aria-pressed',String(activo));});
  }
  buscar.addEventListener('input',actualizar);
  filtros.forEach(b=>b.addEventListener('click',()=>{filtro=b.dataset.filtro;actualizar();}));
  document.getElementById('limpiar-filtros').addEventListener('click',()=>{buscar.value='';filtro='todos';actualizar();buscar.focus();});
  const dialog=document.getElementById('ficha-proveedor');
  document.querySelectorAll('[data-ficha]').forEach(b=>b.addEventListener('click',()=>{const ficha=document.getElementById('ficha-'+b.dataset.ficha);document.getElementById('contenido-ficha').replaceChildren(ficha.content.cloneNode(true));dialog.showModal();document.getElementById('cerrar-ficha').focus();}));
  document.getElementById('cerrar-ficha').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{const r=dialog.getBoundingClientRect();if(e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))dialog.close();});
})();
