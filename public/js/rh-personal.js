document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('[data-rh-importar]');
  const resultado = document.getElementById('rh-resultado');
  if (!form || !resultado) return;
  const avisar = (texto, error) => {
    resultado.className = `alert ${error ? 'alert-danger' : 'alert-success'}`;
    resultado.textContent = texto;
    resultado.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const leer = archivo => new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    lector.onload = () => resolve(String(lector.result).split(',')[1] || '');
    lector.readAsDataURL(archivo);
  });
  form.addEventListener('submit', async evento => {
    evento.preventDefault();
    const archivo = document.getElementById('rh-archivo').files[0];
    if (!archivo || !archivo.name.toLowerCase().endsWith('.xlsx') || archivo.size > 5 * 1024 * 1024) return avisar('Seleccione un archivo Excel .xlsx de hasta 5 MB.', true);
    const desactivarAusentes = document.getElementById('rh-desactivar').checked;
    if (desactivarAusentes && !window.confirm('Las personas que no vienen en el archivo quedarán inactivas. ¿Continuar?')) return;
    const boton = form.querySelector('button');
    boton.disabled = true;
    avisar('Cargando…', false);
    try {
      const respuesta = await fetch('/recursos-humanos/personal/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ archivo: await leer(archivo), desactivarAusentes })
      });
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(datos.error || 'No se pudo cargar el archivo.');
      avisar(`Carga lista: ${datos.total} personas en el archivo · ${datos.nuevos} nuevas · ${datos.actualizados} actualizadas · ${datos.sinCambios} sin cambios` +
        (datos.desactivados ? ` · ${datos.desactivados} marcadas como inactivas` : datos.ausentes ? ` · ${datos.ausentes} no venían en el archivo y se conservaron` : '') + '. Recargando…', false);
      setTimeout(() => location.reload(), 2500);
    } catch (error) {
      avisar(error.message, true);
      boton.disabled = false;
    }
  });
});
