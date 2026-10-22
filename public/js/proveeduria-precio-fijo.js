document.addEventListener('DOMContentLoaded', () => {
  const resultado = document.getElementById('resultado');
  const avisar = (texto, error) => {
    if (!resultado) return;
    resultado.className = `alert ${error ? 'alert-danger' : 'alert-success'}`;
    resultado.textContent = texto;
    resultado.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const enviar = async (url, cuerpo) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(cuerpo) });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(datos.error || 'No se pudo completar la operación.');
    return datos;
  };

  // ---- Administración de precios fijos ----
  const proveedores = new Map([...document.querySelectorAll('#pf-proveedores option')].map(o => [o.value.trim().toLowerCase(), o.dataset.clave]));
  const filtrarGestion = () => {
    const q = (document.querySelector('[data-pf-buscar]')?.value || '').toLowerCase();
    const filtro = document.querySelector('[data-pf-filtro]')?.value || '';
    document.querySelectorAll('[data-pf-fila]').forEach(fila => {
      const con = fila.dataset.conProveedor === '1';
      fila.hidden = (q && !fila.dataset.texto.includes(q)) || (filtro === 'con' && !con) || (filtro === 'sin' && con);
    });
  };
  document.querySelector('[data-pf-buscar]')?.addEventListener('input', filtrarGestion);
  document.querySelector('[data-pf-filtro]')?.addEventListener('change', filtrarGestion);
  document.querySelectorAll('[data-pf-guardar]').forEach(boton => boton.addEventListener('click', async () => {
    const fila = boton.closest('[data-pf-fila]');
    const nombre = fila.querySelector('[data-pf-proveedor]').value.trim();
    const proveedorClave = nombre ? proveedores.get(nombre.toLowerCase()) : '';
    if (nombre && !proveedorClave) return avisar('Elija un proveedor de la lista.', true);
    boton.disabled = true;
    try {
      await enviar('/proveeduria/precios-fijos', {
        clave: boton.dataset.clave,
        proveedor_clave: proveedorClave,
        precio_unitario: fila.querySelector('[data-pf-precio]').value,
        iva: fila.querySelector('[data-pf-iva]').value,
        moneda: fila.querySelector('[data-pf-moneda]').value,
        activo: fila.querySelector('[data-pf-activo]').checked
      });
      fila.dataset.conProveedor = proveedorClave ? '1' : '0';
      avisar(`Guardado: ${fila.cells[0].textContent.trim()}${proveedorClave ? ` · ${nombre}` : ' · sin proveedor'}.`, false);
    } catch (error) {
      avisar(error.message, true);
    } finally {
      boton.disabled = false;
    }
  }));

  // ---- Carrito ----
  const moneda = (n, m) => n.toLocaleString('es-CR', { style: 'currency', currency: m || 'CRC' });
  const recalcular = grupo => {
    let total = 0, monedaGrupo = 'CRC';
    grupo.querySelectorAll('[data-pf-articulo]').forEach(fila => {
      const cantidad = Number(fila.querySelector('[data-pf-cantidad]').value) || 0;
      const subtotal = cantidad * Number(fila.dataset.precio);
      monedaGrupo = fila.dataset.moneda;
      fila.querySelector('[data-pf-subtotal]').textContent = cantidad > 0 ? moneda(subtotal, monedaGrupo) : '—';
      total += subtotal * (1 + Number(fila.dataset.iva) / 100);
    });
    grupo.querySelector('[data-pf-total]').textContent = total > 0 ? moneda(total, monedaGrupo) : '—';
  };
  document.querySelectorAll('[data-pf-grupo]').forEach(grupo => {
    grupo.querySelectorAll('[data-pf-cantidad]').forEach(i => i.addEventListener('input', () => recalcular(grupo)));
    grupo.querySelector('[data-pf-orden]').addEventListener('submit', async evento => {
      evento.preventDefault();
      const items = [...grupo.querySelectorAll('[data-pf-articulo]')]
        .map(f => ({ clave: f.dataset.clave, cantidad: Number(f.querySelector('[data-pf-cantidad]').value) || 0 }))
        .filter(i => i.cantidad > 0);
      if (!items.length) return avisar('Indique la cantidad de al menos un artículo.', true);
      const form = evento.target;
      const datos = Object.fromEntries(new FormData(form));
      const boton = form.querySelector('button');
      boton.disabled = true;
      try {
        const r = await enviar('/proveeduria/precio-fijo/ordenes', { ...datos, proveedor_clave: grupo.dataset.proveedor, items });
        avisar(`Orden de compra PR-${r.id} generada a precio fijo. Abriendo la orden…`, false);
        setTimeout(() => location.assign(r.url), 1200);
      } catch (error) {
        avisar(error.message, true);
        boton.disabled = false;
      }
    });
  });
  document.querySelector('[data-pf-carrito-buscar]')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('[data-pf-grupo]').forEach(grupo => {
      let visibles = 0;
      grupo.querySelectorAll('[data-pf-articulo]').forEach(f => {
        const ver = !q || f.dataset.texto.includes(q) || grupo.dataset.texto.includes(q);
        f.hidden = !ver;
        if (ver) visibles++;
      });
      grupo.hidden = visibles === 0;
    });
  });
});
