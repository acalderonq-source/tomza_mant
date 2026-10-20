document.addEventListener('DOMContentLoaded', () => {
  const mensaje = document.getElementById('noticias-mensaje');
  const token = document.querySelector('meta[name="csrf-token"]')?.content;
  async function enviar(url, body) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': token || '' }, body: JSON.stringify(body) });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'No se pudo guardar. Revise su sesion e intente nuevamente.');
    }
  }
  const leer = file => new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.')); reader.readAsDataURL(file);
  });
  document.getElementById('noticia-subir').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button');
    if (button.disabled) return;
    const files = Array.from(form.elements.archivos.files);
    if (files.some(file => file.size > 4 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) {
      mensaje.textContent = 'Seleccione imagenes PNG, JPG o WebP de hasta 4 MB cada una.'; return;
    }
    button.disabled = true; let guardadas = 0;
    try {
      for (const file of files) {
        mensaje.textContent = `Subiendo ${guardadas + 1} de ${files.length}...`;
        await enviar('/admin/noticias', { titulo: form.elements.titulo.value.trim() || file.name.slice(0, 120), orden: Number(form.elements.orden.value), activa: true, imagen: await leer(file) });
        guardadas++;
      }
      window.location.reload();
    } catch (error) {
      mensaje.textContent = `${guardadas ? guardadas + ' imagen(es) guardadas. ' : ''}${error.message}`;
      // Do not resend successful files if a later upload failed.
      if (guardadas) { form.reset(); mensaje.textContent += ' Actualice la pagina para verlas y vuelva a elegir solo las pendientes.'; }
    } finally { button.disabled = false; }
  });
  document.querySelectorAll('.noticia-editar').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault(); const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try { await enviar(form.action, { titulo: form.elements.titulo.value, orden: Number(form.elements.orden.value), activa: form.elements.activa.checked }); mensaje.textContent = 'Noticia actualizada.'; }
    catch (error) { mensaje.textContent = error.message; } finally { button.disabled = false; }
  }));
  document.querySelectorAll('.noticia-eliminar').forEach(button => button.addEventListener('click', async () => {
    if (!window.confirm('¿Eliminar esta noticia del inicio?')) return;
    button.disabled = true;
    try { await enviar(`/admin/noticias/${button.dataset.id}/eliminar`, {}); button.closest('article').remove(); mensaje.textContent = 'Noticia eliminada.'; }
    catch (error) { mensaje.textContent = error.message; button.disabled = false; }
  }));
});
