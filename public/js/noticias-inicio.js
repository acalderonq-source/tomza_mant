document.addEventListener('DOMContentLoaded', async () => {
  const mapa = document.querySelector('.sedes-panel');
  if (!mapa) return;
  let noticias;
  try {
    const response = await fetch('/inicio/noticias', { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const data = await response.json();
    noticias = (data.noticias || []).filter(n => Number.isInteger(n.id) && typeof n.titulo === 'string' && n.imagen === `/inicio/noticias/${n.id}/imagen`);
  } catch (_) { return; }
  if (!noticias.length) return;
  const carrusel = document.createElement('div'); carrusel.className = 'inicio-carrusel';
  carrusel.setAttribute('role', 'region'); carrusel.setAttribute('aria-label', 'Mapa y noticias de Gas Tomza');
  carrusel.setAttribute('aria-roledescription', 'carrusel');
  mapa.before(carrusel);
  const stage = document.createElement('div'); stage.className = 'inicio-carrusel-stage'; carrusel.append(stage); stage.append(mapa);
  const noticia = document.createElement('figure'); noticia.className = 'inicio-noticia'; noticia.hidden = true;
  const imagen = document.createElement('img'), pie = document.createElement('figcaption'); noticia.append(imagen, pie); stage.append(noticia);
  const controles = document.createElement('div'); controles.className = 'inicio-carrusel-controles';
  const crearBoton = (label, icon) => { const button = document.createElement('button'); button.type = 'button'; button.title = label; button.setAttribute('aria-label', label); button.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i>`; controles.append(button); return button; };
  const anterior = crearBoton('Anterior', 'bi-chevron-left');
  const contador = document.createElement('span'); contador.className = 'inicio-carrusel-contador'; contador.setAttribute('aria-live', 'off'); controles.append(contador);
  const siguiente = crearBoton('Siguiente', 'bi-chevron-right');
  const pausa = crearBoton('Pausar noticias', 'bi-pause-fill');
  const verMapa = document.createElement('button'); verMapa.type = 'button'; verMapa.textContent = 'Ver mapa'; controles.append(verMapa); carrusel.append(controles);
  let indice = 0, timer, pausado = window.matchMedia('(prefers-reduced-motion: reduce)').matches, interactuando = false, foco = false;
  const total = noticias.length + 1;
  function programar() {
    clearTimeout(timer);
    if (!pausado && !interactuando && !foco && !document.hidden) timer = setTimeout(() => mostrar((indice + 1) % total), 10000);
  }
  function mostrar(value) {
    indice = value;
    const esMapa = indice === 0;
    mapa.style.visibility = esMapa ? '' : 'hidden'; mapa.inert = !esMapa; mapa.setAttribute('aria-hidden', String(!esMapa));
    noticia.hidden = esMapa;
    if (!esMapa) { const n = noticias[indice - 1]; imagen.hidden = false; imagen.alt = n.titulo; imagen.src = n.imagen; pie.textContent = n.titulo; }
    contador.textContent = `${esMapa ? 'Mapa' : 'Noticias'} · ${indice + 1} / ${total}`;
    verMapa.disabled = esMapa; programar();
  }
  function actualizarPausa() {
    const label = pausado ? 'Reanudar noticias' : 'Pausar noticias'; pausa.title = label; pausa.setAttribute('aria-label', label);
    pausa.setAttribute('aria-pressed', String(pausado)); pausa.querySelector('i').className = `bi ${pausado ? 'bi-play-fill' : 'bi-pause-fill'}`; programar();
  }
  anterior.addEventListener('click', () => mostrar((indice - 1 + total) % total));
  siguiente.addEventListener('click', () => mostrar((indice + 1) % total));
  pausa.addEventListener('click', () => { pausado = !pausado; actualizarPausa(); });
  verMapa.addEventListener('click', () => { pausado = true; mostrar(0); actualizarPausa(); });
  carrusel.addEventListener('pointerenter', () => { interactuando = true; programar(); });
  carrusel.addEventListener('pointerleave', () => { interactuando = false; programar(); });
  carrusel.addEventListener('focusin', () => { foco = true; programar(); });
  carrusel.addEventListener('focusout', () => { setTimeout(() => { foco = carrusel.contains(document.activeElement); programar(); }, 0); });
  // A touch or click on the map must not be interrupted by an automatic slide.
  mapa.addEventListener('pointerdown', () => { pausado = true; actualizarPausa(); });
  document.addEventListener('visibilitychange', programar);
  imagen.addEventListener('error', () => { imagen.hidden = true; pie.textContent = 'No se pudo cargar esta noticia. Puede volver al mapa.'; });
  mostrar(0); actualizarPausa();
});
