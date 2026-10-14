(function () {
  document.querySelectorAll('form[data-aceite-destino]').forEach(form => {
    const destino = form.querySelector('[name="destino"]');
    const buscar = form.querySelector('[data-aceite-placa-buscar]');
    function filtrar() {
      const texto = (buscar?.value || '').trim().toLowerCase();
      form.querySelectorAll('select[name="sede"], select[name="unidad_id"]').forEach(select => {
        for (const option of select.options) {
          if (!option.value) continue;
          const visible = option.dataset.destino === destino.value &&
            (select.name !== 'unidad_id' || option.textContent.toLowerCase().includes(texto));
          option.hidden = !visible;
          option.disabled = !visible;
        }
        if (select.selectedOptions[0]?.disabled) {
          select.value = '';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (select.name === 'sede' && !select.value) {
          const disponibles = Array.from(select.options).filter(option => option.value && !option.disabled);
          if (disponibles.length === 1) select.value = disponibles[0].value;
        }
      });
    }
    destino.addEventListener('change', filtrar);
    buscar?.addEventListener('input', filtrar);
    filtrar();
  });
})();
