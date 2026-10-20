(() => {
  const form = document.querySelector('[data-solicitud-inventario]');
  if (!form) return;
  const { articulos = [] } = JSON.parse(document.getElementById('prov-datos').textContent);
  const body = form.querySelector('tbody');
  const agregar = form.querySelector('[data-agregar-articulo]');
  const enviar = form.querySelector('button:not([type]),button[type="submit"]');
  const aviso = form.querySelector('[data-catalogo-vacio]');
  let catalogo = [];
  function validarRepetidos() {
    const selects = [...body.querySelectorAll('[data-campo="codigo"]')];
    selects.forEach(s => s.setCustomValidity(s.value && selects.some(otro => otro !== s && otro.value === s.value)
      ? 'Este artículo ya está en la solicitud. Ajuste su cantidad.' : ''));
  }

  function fila() {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td data-label="Categoría"><select class="form-select" aria-label="Categoría" data-campo="categoria" required><option value="">Seleccione una categoría</option></select></td><td data-label="Producto a solicitar"><select class="form-select" aria-label="Producto a solicitar" data-campo="codigo" required disabled><option value="">Seleccione primero una categoría</option></select><small class="text-muted" data-origen-producto></small></td><td data-label="Código automático"><input class="form-control codigo" aria-label="Código automático" placeholder="Automático" readonly></td><td data-label="Cantidad"><input class="form-control cantidad" aria-label="Cantidad solicitada" data-campo="cantidad" type="number" min="0.001" step="0.001" value="1" required></td><td><button class="btn btn-outline-danger" type="button" aria-label="Quitar artículo">×</button></td>';
    const categoria = tr.querySelector('[data-campo="categoria"]');
    const select = tr.querySelector('[data-campo="codigo"]');
    for (const nombre of [...new Set(catalogo.map(a => a.categoria))].sort((a,b) => a.localeCompare(b,'es'))) {
      const option = document.createElement('option');
      option.value = option.textContent = nombre;
      categoria.append(option);
    }
    categoria.addEventListener('change', () => {
      select.replaceChildren();
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = categoria.value ? 'Seleccione un producto' : 'Seleccione primero una categoría';
      select.append(placeholder);
      select.disabled = !categoria.value;
      tr.querySelector('.codigo').value = '';
      tr.querySelector('[data-origen-producto]').textContent = '';
      for (const [label, fueraInventario] of [['Inventario general', false], ['Compra por solicitud', true]]) {
        const grupo = document.createElement('optgroup');
        grupo.label = label;
        for (const a of catalogo.filter(a => a.categoria === categoria.value && (a.inventariable === false) === fueraInventario)) {
          const option = document.createElement('option');
          option.value = a.codigo;
          option.textContent = `${a.descripcion} · ${a.codigo} (${a.unidad})`;
          grupo.append(option);
        }
        if (grupo.children.length) select.append(grupo);
      }
      validarRepetidos();
    });
    select.addEventListener('change', () => {
      tr.querySelector('.codigo').value = select.value;
      tr.querySelector('[data-origen-producto]').textContent = catalogo.find(a => a.codigo === select.value)?.inventariable === false ? 'Compra por solicitud · Sin control de inventario' : '';
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
    catalogo = articulos;
    body.replaceChildren();
    agregar.disabled = enviar.disabled = !catalogo.length;
    aviso.hidden = catalogo.length > 0;
    aviso.textContent = 'Todavía no hay artículos disponibles para solicitar a Proveeduría.';
    if (catalogo.length) fila();
  }
  agregar.addEventListener('click', fila);
  actualizarSede();
})();
