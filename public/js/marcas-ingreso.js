document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);
  const abrir = $('abrir-camara'), tomar = $('tomar-foto'), guardar = $('guardar-marca'), repetir = $('repetir-foto');
  const panel = $('marca-camara'), video = $('camara-video'), preview = $('foto-preview'), mensaje = $('marca-mensaje');
  let stream, reto, foto, estado, iniciando = false, guardando = false, baseServidor, baseReloj, versionCamara = 0;
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
  async function api(url, body) {
    const response = await fetch('/marcas-ingreso/' + url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) } : { headers: { Accept: 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la operacion. Revise sus marcas.');
    return data;
  }
  function cerrar() {
    versionCamara++;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null; video.srcObject = null; preview.removeAttribute('src'); foto = null; reto = null;
    panel.hidden = true; abrir.disabled = !estado || guardando;
  }
  function actualizarHora() {
    if (!baseServidor) return;
    const ahora = new Date(baseServidor + performance.now() - baseReloj);
    $('reloj-hora').textContent = new Intl.DateTimeFormat('es-CR', { timeZone: 'America/Costa_Rica', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(ahora);
    $('reloj-fecha').textContent = new Intl.DateTimeFormat('es-CR', { timeZone: 'America/Costa_Rica', dateStyle: 'full' }).format(ahora);
  }
  async function cargarEstado() {
    estado = await api('estado'); baseServidor = estado.servidor; baseReloj = performance.now(); actualizarHora();
    $('marca-estado').textContent = estado.siguiente === 'ENTRADA' ? 'Listo para registrar entrada' : 'Entrada registrada · Pendiente de salida';
    abrir.textContent = estado.siguiente === 'ENTRADA' ? 'Registrar entrada' : 'Registrar salida'; abrir.disabled = false;
  }
  abrir.addEventListener('click', async () => {
    if (iniciando || guardando) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) { mensaje.textContent = 'La camara requiere HTTPS y un navegador compatible. No se permite adjuntar desde galeria.'; return; }
    iniciando = true; abrir.disabled = true; mensaje.textContent = '';
    const version = ++versionCamara;
    try {
      const nueva = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (version !== versionCamara || document.hidden) { nueva.getTracks().forEach(t => t.stop()); return; }
      stream = nueva;
      video.srcObject = stream; panel.hidden = false; preview.hidden = true; video.hidden = false; tomar.hidden = false; tomar.disabled = true; guardar.hidden = true; repetir.hidden = true;
      await video.play();
      if (version !== versionCamara) return;
      const nuevoReto = await api('reto', {});
      if (version !== versionCamara) return;
      reto = nuevoReto; $('camara-titulo').textContent = reto.tipo === 'ENTRADA' ? 'Foto de entrada' : 'Foto de salida';
      $('camara-estado').textContent = 'Tome la foto y confirme la marca en los proximos dos minutos.';
      tomar.disabled = false; panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (error) {
      cerrar();
      const errores = { NotAllowedError: 'Permita el acceso a la camara para marcar. No se aceptan fotos de galeria.', NotFoundError: 'No se encontro una camara. Abra el sistema en un celular o equipo con camara.', NotReadableError: 'No se pudo usar la camara. Cierre otras aplicaciones que la utilicen e intente nuevamente.', OverconstrainedError: 'La camara no admite esta captura. Intente desde Chrome en su celular.' };
      mensaje.textContent = errores[error.name] || error.message || 'No se pudo abrir la camara.';
    }
    finally { iniciando = false; }
  });
  tomar.addEventListener('click', () => {
    if (!reto || !video.videoWidth || !stream?.getVideoTracks().some(t => t.readyState === 'live')) { mensaje.textContent = 'La camara no esta lista. Vuelva a abrirla.'; return; }
    const canvas = document.createElement('canvas');
    const escala = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * escala); canvas.height = Math.round(video.videoHeight * escala);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const captura = canvas.toDataURL('image/jpeg', .8); foto = captura.split(',')[1];
    if (foto.length > 1398104) { foto = null; mensaje.textContent = 'La foto es demasiado grande. Vuelva a tomarla.'; return; }
    preview.src = captura; preview.hidden = false; video.hidden = true; tomar.hidden = true; repetir.hidden = false; guardar.hidden = false;
    $('camara-estado').textContent = 'Foto lista. Confirme para registrar la hora del servidor.';
  });
  repetir.addEventListener('click', () => { foto = null; preview.removeAttribute('src'); preview.hidden = true; video.hidden = false; tomar.hidden = false; guardar.hidden = true; repetir.hidden = true; });
  $('cancelar-foto').addEventListener('click', () => { if (!guardando) cerrar(); });
  guardar.addEventListener('click', async () => {
    if (guardando || !foto || !reto) return;
    guardando = true; guardar.disabled = true; repetir.disabled = true; $('cancelar-foto').disabled = true;
    stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null;
    try { await api('registrar', { tipo: reto.tipo, token: reto.token, foto }); cerrar(); window.location.reload(); }
    catch (error) { cerrar(); mensaje.textContent = error.message; await cargarEstado().catch(() => { estado = null; abrir.disabled = true; }); }
    finally { guardando = false; guardar.disabled = false; repetir.disabled = false; $('cancelar-foto').disabled = false; abrir.disabled = !estado; }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && !guardando) cerrar(); });
  window.addEventListener('pagehide', cerrar);
  cargarEstado().catch(error => { mensaje.textContent = error.message; $('marca-estado').textContent = 'Estado no disponible'; });
  setInterval(actualizarHora, 1000);
});
