(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const fecha = value => new Intl.DateTimeFormat('es-CR', { timeZone: 'America/Costa_Rica', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  let datos, pagina = 0, solicitud = 0, seleccionado;
  function nodo(tag, texto, clase) {
    const el = document.createElement(tag);
    if (texto !== undefined) el.textContent = texto;
    if (clase) el.className = clase;
    return el;
  }
  function svgNodo(tag, attrs, texto) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    if (texto !== undefined) el.textContent = texto;
    return el;
  }
  function graficar() {
    const svg = svgNodo('svg', { viewBox: '0 0 720 250', role: 'img', 'aria-labelledby': 'titulo-grafico descripcion-grafico' });
    svg.append(svgNodo('title', { id: 'titulo-grafico' }, 'Eventos registrados y solicitudes rechazadas por día'),
      svgNodo('desc', { id: 'descripcion-grafico' }, datos.tendencia.map(r => `${r.fecha}: ${r.detectados} detectados, ${r.bloqueados} bloqueados`).join('; ')));
    const max = Math.max(4, ...datos.tendencia.map(r => r.detectados));
    const x = i => 36 + i * 664 / (datos.tendencia.length - 1);
    const y = value => 210 - value / max * 175;
    for (let i = 0; i <= 4; i++) {
      const value = max * i / 4;
      svg.append(svgNodo('line', { x1: 36, x2: 700, y1: y(value), y2: y(value), class: 'chart-grid' }),
        svgNodo('text', { x: 6, y: y(value) + 4, class: 'chart-label' }, Number(value.toFixed(1))));
    }
    const puntos = key => datos.tendencia.map((r, i) => `${x(i)},${y(r[key])}`).join(' ');
    svg.append(svgNodo('polygon', { points: `36,210 ${puntos('detectados')} 700,210`, class: 'chart-total' }),
      svgNodo('polyline', { points: puntos('detectados'), class: 'chart-line' }),
      svgNodo('polyline', { points: puntos('bloqueados'), class: 'chart-line chart-blocked' }));
    [0, Math.floor((datos.tendencia.length - 1) / 2), datos.tendencia.length - 1].forEach(i => {
      svg.append(svgNodo('text', { x: x(i), y: 238, 'text-anchor': i === 0 ? 'start' : i === datos.tendencia.length - 1 ? 'end' : 'middle', class: 'chart-label' }, datos.tendencia[i].fecha.slice(5).split('-').reverse().join('/')));
    });
    $('tendencia').replaceChildren(svg);
    $('tipos').replaceChildren(...datos.tipos.map(row => {
      const div = nodo('div'), label = nodo('div', undefined, 'type-label');
      label.append(nodo('span', row.tipo), nodo('span', `${row.total} / ${datos.total ? Math.round(row.total / datos.total * 100) : 0}%`));
      const progress = nodo('progress'); progress.max = datos.total || 1; progress.value = row.total;
      progress.setAttribute('aria-label', `${row.tipo}: ${row.total} eventos`);
      div.append(label, progress); return div;
    }));
  }
  function tabla() {
    const rows = datos.incidentes;
    $('incidentes').replaceChildren(...rows.map(row => {
      const tr = nodo('tr'), id = nodo('td', `INC-${row.id}`), equipo = nodo('td', row.usuario);
      id.append(nodo('small', fecha(row.fecha))); equipo.append(nodo('small', row.departamento));
      const gravedad = nodo('td'), estado = nodo('td');
      const clase = row.gravedad.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      gravedad.append(nodo('span', row.gravedad, `badge severity-${clase}`));
      const revisar = nodo('button', row.estado); revisar.type = 'button'; revisar.setAttribute('aria-label', `Revisar incidente ${row.id}: ${row.estado}`);
      revisar.addEventListener('click', () => abrir(row)); estado.append(revisar);
      const tipo = nodo('td', row.tipo); tipo.append(nodo('small', `${row.intentos} intento(s) · HTTP ${row.http_estado}`));
      tr.append(id, tipo, nodo('td', row.origen), equipo, gravedad, estado); return tr;
    }));
    if (!rows.length) { const tr = nodo('tr'), td = nodo('td', 'No hay eventos registrados para estos filtros.'); td.colSpan = 6; tr.append(td); $('incidentes').append(tr); }
    $('pagina').textContent = `Página ${pagina + 1} de ${Math.max(1, Math.ceil(datos.grupos / 12))}`;
    $('anterior').disabled = pagina === 0;
    $('siguiente').disabled = (pagina + 1) * 12 >= datos.grupos;
    $('conteo').textContent = `${datos.grupos} GRUPOS / ${datos.total} INTENTOS`;
  }
  async function cargar() {
    const actual = ++solicitud;
    $('panel').setAttribute('aria-busy', 'true'); $('exportar').disabled = true;
    $('estado').textContent = 'Consultando registro real…';
    $('anterior').disabled = true; $('siguiente').disabled = true;
    try {
      const response = await fetch(`/admin/ciberseguridad/datos?${parametros()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('No se pudo cargar el panel. Revise su sesión y vuelva a cambiar un filtro para reintentar.');
      const result = await response.json();
      if (actual !== solicitud) return;
      datos = result; pagina = datos.pagina;
      if (pagina > 0 && pagina * 12 >= datos.grupos) { pagina = 0; return cargar(); }
      ['total', 'bloqueados', 'pendientes', 'resueltos'].forEach(id => { $(id).textContent = datos[id].toLocaleString('es-CR'); });
      $('porcentaje').textContent = `${datos.total ? (datos.bloqueados / datos.total * 100).toFixed(1) : '0'}% de los eventos · HTTP 401/403/429`;
      $('rango').textContent = `${datos.periodo.desde.split('-').reverse().join('/')} — ${datos.periodo.hasta.split('-').reverse().join('/')} · Costa Rica`;
      $('inicio').textContent = datos.inicio ? `Registro activo desde ${fecha(datos.inicio)}. No hay datos anteriores a la activación.` : 'Registro iniciado con esta versión del sistema.';
      const fallos = Number(datos.registro?.fallos || 0) + Number(datos.registro?.descartados || 0);
      $('salud').hidden = fallos === 0;
      $('salud').textContent = `Registro incompleto: ${fallos} eventos no se pudieron guardar durante esta ejecución. Revise los logs del servidor.`;
      graficar(); tabla(); $('exportar').disabled = false;
      $('estado').textContent = `Registro actualizado ${new Date().toLocaleTimeString('es-CR')} · ${datos.total} eventos · Gravedad: ${$('gravedad').value}`;
    } catch (error) {
      if (actual !== solicitud) return;
      $('estado').textContent = `${error.message} Los valores anteriores pueden estar desactualizados.`;
    } finally { if (actual === solicitud) $('panel').setAttribute('aria-busy', 'false'); }
  }
  function parametros() { return new URLSearchParams({ dias: $('periodo').value, gravedad: $('gravedad').value, pagina: String(pagina) }); }
  for (const id of ['periodo', 'gravedad']) $(id).addEventListener('change', () => { pagina = 0; cargar(); });
  $('actualizar').addEventListener('click', cargar);
  $('anterior').addEventListener('click', () => { if (pagina > 0) { pagina--; cargar(); } });
  $('siguiente').addEventListener('click', () => { if (datos && (pagina + 1) * 12 < datos.grupos) { pagina++; cargar(); } });
  $('exportar').addEventListener('click', async () => {
    if (!datos) return;
    $('exportar').disabled = true;
    try {
      const response = await fetch(`/admin/ciberseguridad/exportar.csv?${parametros()}`, { cache: 'no-store' });
      if (!response.ok) throw Error((await response.json()).error || 'No se pudo exportar.');
      const url = URL.createObjectURL(await response.blob());
      const a = nodo('a'); a.href = url; a.download = `ciberseguridad-${datos.periodo.desde}-${datos.periodo.hasta}.csv`;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { $('estado').textContent = error.message; } finally { $('exportar').disabled = false; }
  });
  async function abrir(row) {
    seleccionado = row; $('seguimiento-titulo').textContent = `Incidente INC-${row.id}`;
    $('seguimiento-detalle').textContent = `${row.tipo} · ${row.ruta} · Último evento: ${fecha(row.ultimo)} · ${row.intentos} intento(s)`;
    $('nuevo-estado').value = row.estado; $('nota').value = ''; $('seguimiento-error').textContent = '';
    $('historial').textContent = 'Consultando historial…'; $('seguimiento').showModal();
    try {
      const res = await fetch(`/admin/ciberseguridad/${row.id}/seguimiento`, { cache: 'no-store' });
      if (!res.ok) throw Error('No se pudo consultar el historial.');
      const { historial } = await res.json();
      if (seleccionado !== row) return;
      $('historial').replaceChildren(...historial.map(r => {
        const p = nodo('p', `${fecha(r.fecha)} · ${r.administrador || 'Administración'} · ${r.estado}`);
        p.append(nodo('small', r.nota)); return p;
      }));
      if (!historial.length) $('historial').textContent = 'Sin revisiones anteriores.';
    } catch (error) { if (seleccionado === row) $('historial').textContent = error.message; }
  }
  $('cerrar').addEventListener('click', () => $('seguimiento').close());
  $('seguimiento').addEventListener('close', () => { seleccionado = null; });
  $('form-seguimiento').addEventListener('submit', async event => {
    event.preventDefault(); if (!seleccionado) return;
    $('guardar').disabled = true; $('cerrar').disabled = true;
    try {
      const res = await fetch(`/admin/ciberseguridad/${seleccionado.id}/seguimiento`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': document.querySelector('meta[name="csrf-token"]')?.content || '' }, body: JSON.stringify({ estado: $('nuevo-estado').value, nota: $('nota').value, version: seleccionado.version }) });
      if (!res.ok) throw Error((await res.json()).error || 'No se pudo guardar.');
      $('seguimiento').close(); await cargar();
    } catch (error) { $('seguimiento-error').textContent = error.message; }
    finally { $('guardar').disabled = false; $('cerrar').disabled = false; }
  });
  setInterval(() => { if (!document.hidden && !$('seguimiento').open && $('panel').getAttribute('aria-busy') !== 'true') cargar(); }, 60000);
  cargar();
})();
