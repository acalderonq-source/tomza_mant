document.addEventListener('DOMContentLoaded', async () => {
  const link = document.querySelector('a[data-auto-descargar="1"]');
  if (!link) return;
  link.dataset.autoDescargar = '0';
  const location = new URL(window.location.href);
  location.searchParams.delete('descargar');
  history.replaceState(history.state, '', location.pathname + location.search + location.hash);
  const status = document.createElement('p');
  status.className = 'alert alert-info';
  status.setAttribute('role', 'status');
  status.textContent = 'Orden guardada. Preparando la descarga del PDF…';
  const heading = link.closest('.page-heading');
  if (heading) heading.after(status); else link.after(status);
  let objectUrl;
  try {
    const target = new URL(link.href, window.location.href);
    if (target.origin !== window.location.origin) throw new Error('Origen no permitido');
    const response = await fetch(target.href, { credentials: 'same-origin' });
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/pdf')) throw new Error('PDF no disponible');
    const blob = await response.blob();
    const filename = response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/i)?.[1] || 'Orden-de-compra.pdf';
    objectUrl = URL.createObjectURL(blob);
    const download = document.createElement('a');
    download.href = objectUrl;
    download.download = filename.replace(/[\\/]/g, '_');
    document.body.appendChild(download); download.click(); download.remove();
    status.textContent = 'Orden guardada. Descarga del PDF solicitada. Si no aparece, use Descargar PDF.';
    status.className = 'alert alert-success';
  } catch (_) {
    status.textContent = 'La orden está guardada, pero no se pudo descargar el PDF. Use Descargar PDF para reintentar; no vuelva a guardar la orden.';
    status.className = 'alert alert-warning';
  } finally {
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }
});
