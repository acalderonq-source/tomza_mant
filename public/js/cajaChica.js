(() => {
  'use strict';
  const base = '/compras/facturas/caja-chica';
  const byId = id => document.getElementById(id);
  const format = cents => (cents / 100).toLocaleString('es-CR', { style: 'currency', currency: 'CRC' });
  const cents = value => Math.round(Number(value || 0) * 100) || 0;
  const showAmount = (id, value) => { if (byId(id)) byId(id).textContent = format(value); };
  const selections = Array.from(document.querySelectorAll('.js-seleccion'));
  const rows = Array.from(document.querySelectorAll('.ready-row'));

  function updateTotals() {
    const selected = selections.filter(input => input.checked);
    const totalFor = company => selected.filter(input => input.dataset.empresa === company)
      .reduce((total, input) => total + cents(input.dataset.monto), 0);
    const tomza = totalFor('GAS TOMZA');
    const superGas = totalFor('SUPER GAS');
    const cash = Array.from(document.querySelectorAll('.js-efectivo')).reduce((total, input) =>
      total + cents(input.dataset.denominacion) * Math.max(0, Math.trunc(Number(input.value) || 0)), 0);
    const total = tomza + superGas + cash + cents(byId('vales')?.value);
    if (byId('cantidad-seleccion')) byId('cantidad-seleccion').textContent = selected.length;
    showAmount('monto-tomza', tomza);
    showAmount('monto-super', superGas);
    showAmount('monto-total', tomza + superGas);
    showAmount('monto-efectivo', cash);
    showAmount('total-caja', total);
    showAmount('diferencia', cents(byId('base-caja')?.value) - total);
    if (byId('generar-corte')) byId('generar-corte').disabled = !selected.length;
    const visible = selections.filter(input => !input.closest('tr').hidden);
    const checked = visible.filter(input => input.checked).length;
    if (byId('seleccionar-todas')) {
      byId('seleccionar-todas').checked = visible.length > 0 && checked === visible.length;
      byId('seleccionar-todas').indeterminate = checked > 0 && checked < visible.length;
    }
  }

  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function filterRows() {
    const query = normalize(byId('buscar-listas')?.value || '');
    const company = byId('empresa-listas')?.value;
    rows.forEach(row => {
      row.hidden = Boolean((company && row.dataset.empresa !== company) || !normalize(row.textContent).includes(query));
    });
    updateTotals();
  }
  byId('buscar-listas')?.addEventListener('input', filterRows);
  byId('empresa-listas')?.addEventListener('change', filterRows);
  byId('seleccionar-todas')?.addEventListener('change', event => {
    selections.filter(input => !input.disabled && !input.closest('tr').hidden).forEach(input => { input.checked = event.target.checked; });
    updateTotals();
  });
  document.querySelectorAll('.js-seleccion,.js-arqueo,.js-efectivo').forEach(input => input.addEventListener('input', updateTotals));

  byId('documento')?.addEventListener('show.bs.modal', event => {
    const data = event.relatedTarget?.dataset;
    if (!data) return;
    const form = byId('form-documento');
    form.reset();
    const mode = data.mode;
    if (mode !== 'manual' && !/^\d+$/.test(data.id || '')) return;
    form.action = mode === 'manual' ? `${base}/documentos/manual` : mode === 'editar'
      ? `${base}/documentos/${data.id}/actualizar` : `${base}/electronicas/${data.id}/confirmar`;
    const fields = ['empresa', 'fecha', 'numero', 'proveedor', 'monto', 'unidad', 'cuenta', 'concepto', 'tipo'];
    fields.forEach(field => { byId(`doc-${field}`).value = data[field] || ''; });
    if (!data.fecha) byId('doc-fecha').value = byId('fecha-corte')?.value || '';
    byId('doc-unidad').value ||= '-';
    byId('doc-tipo').value = mode === 'manual' ? 'SIMPLIFICADO' : data.tipo;
    const title = mode === 'manual' ? 'Agregar factura simplificada' : mode === 'editar' ? 'Editar factura confirmada' : 'Confirmar factura recibida';
    byId('documento-titulo').textContent = title;
    byId('guardar-documento').textContent = mode === 'confirmar' ? 'Confirmar recibida' : 'Guardar factura';
    byId('guardar-documento').disabled = false;
  });
  byId('form-documento')?.addEventListener('submit', () => { byId('guardar-documento').disabled = true; });
  document.querySelectorAll('.js-retirar').forEach(button => button.addEventListener('click', () => {
    if (!/^\d+$/.test(button.dataset.id) || !window.confirm('¿Retirar esta factura de la preparación? Si es electrónica, volverá a estar pendiente de confirmación.')) return;
    const form = byId('retirar-documento');
    form.action = `${base}/documentos/${button.dataset.id}/eliminar`;
    form.submit();
  }));
  byId('form-corte')?.addEventListener('submit', event => {
    const selected = selections.filter(input => input.checked);
    if (!selected.length || !window.confirm(`¿Cerrar la caja con ${selected.length} factura(s), por ${format(selected.reduce((total, input) => total + cents(input.dataset.monto), 0))}? Las facturas del corte quedarán bloqueadas para edición.`)) {
      event.preventDefault();
      return;
    }
    byId('generar-corte').disabled = true;
  });

  function activateTab() {
    const name = window.location.hash.slice(1);
    if (['recibidas', 'preparar', 'cortes'].includes(name) && window.bootstrap) {
      bootstrap.Tab.getOrCreateInstance(byId(`tab-${name}`)).show();
    }
  }
  document.querySelectorAll('[data-bs-toggle="tab"]').forEach(tab => tab.addEventListener('shown.bs.tab', () => {
    history.replaceState(null, '', `${location.pathname}${location.search}${tab.dataset.bsTarget}`);
  }));
  window.addEventListener('hashchange', activateTab);
  window.addEventListener('pageshow', () => { updateTotals(); if (byId('guardar-documento')) byId('guardar-documento').disabled = false; });
  activateTab();
  updateTotals();
})();
