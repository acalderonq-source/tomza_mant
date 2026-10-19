(() => {
  const form = document.querySelector('[data-solicitud-inventario]');
  if (!form) return;
  const { articulos = [] } = JSON.parse(document.getElementById('prov-datos').textContent);
  const sede = form.elements.sede;
  const body = form.querySelector('tbody');
  const agregar = form.querySelector('[data-agregar-articulo]');
  const enviar = form.querySelector('button:not([type]),button[type="submit"]');
  const aviso = form.querySelector('[data-catalogo-vacio]');
  let catalogo = [];
  function validarRepetidos() {
    const selects = [...body.querySelectorAll('select')];
    selects.forEach(s => s.setCustomValidity(s.value && selects.some(otro => otro !== s && otro.value === s.value)
      ? 'Este artículo ya está en la solicitud. Ajuste su cantidad.' : ''));
  }

  function fila() {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td><select class="form-select" aria-label="Producto de inventario" data-campo="codigo" required><option value="">Seleccione un producto</option></select></td><td><input class="form-control codigo" aria-label="Código automático" placeholder="Automático" readonly></td><td><input class="form-control cantidad" aria-label="Cantidad solicitada" data-campo="cantidad" type="number" min="0.001" step="0.001" value="1" required></td><td><button class="btn btn-outline-danger" type="button" aria-label="Quitar artículo">×</button></td>';
    const select = tr.querySelector('select');
    for (const a of catalogo) {
      const option = document.createElement('option');
      option.value = a.codigo;
      option.textContent = `${a.descripcion} · ${a.codigo} (${a.unidad})`;
      select.append(option);
    }
    select.addEventListener('change', () => {
      tr.querySelector('.codigo').value = select.value;
      validarRepetidos();
    });
    tr.querySelector('button').addEventListener('click', () => {
      tr.remove();
      validarRepetidos();
      if (!body.children.length) fila();
      agregar.disabled = body.children.length >= 200;
    });
    body.append(tr);
    agregar.disabled = body.children.length >= 200;
  }

  function actualizarSede() {
    catalogo = articulos.filter(a => a.sede === sede.value);
    body.replaceChildren();
    agregar.disabled = enviar.disabled = !catalogo.length;
    aviso.hidden = catalogo.length > 0;
    aviso.textContent = sede.value
      ? 'Esta sede todavía no tiene artículos registrados en el inventario de Proveeduría. Solicite a Proveeduría que los registre.'
      : 'Seleccione una sede para ver sus productos de Proveeduría.';
    if (catalogo.length) fila();
  }
  sede.addEventListener('change', actualizarSede);
  agregar.addEventListener('click', fila);
  actualizarSede();
})();
