(() => {
  const unidad = document.getElementById('unidad');
  const buscar = document.getElementById('unidad-buscar');
  if (!unidad || unidad.disabled) return;
  const opciones = Array.from(unidad.options).map(option => option.cloneNode(true));
  buscar.addEventListener('input', () => {
    const texto = buscar.value.trim().toUpperCase();
    const seleccionado = unidad.value;
    unidad.replaceChildren(...opciones.filter(o => !o.value || o.value === seleccionado || o.textContent.toUpperCase().includes(texto)).map(o => o.cloneNode(true)));
    unidad.value = seleccionado;
  });
  unidad.addEventListener('change', () => {
    const option = unidad.selectedOptions[0];
    for (const key of ['placa', 'marca', 'almacenamiento', 'anio']) {
      const input = document.getElementById(`f-${key}`);
      if (input) input.value = option?.dataset[key] || '';
    }
  });
})();
