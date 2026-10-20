(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const fecha = value => new Intl.DateTimeFormat('es-CR', { timeZone: 'America/Costa_Rica', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  let datos, pagina = 0, solicitud = 0;
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
    svg.append(svgNodo('title', { id: 'titulo-grafico' }, 'Ataques detectados y bloqueados por día'),
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
    const rows = datos.incidentes.slice(pagina * 12, (pagina + 1) * 12);
    $('incidentes').replaceChildren(...rows.map(row => {
      const tr = nodo('tr'), id = nodo('td', row.id), equipo = nodo('td', row.equipo);
      id.append(nodo('small', fecha(row.fecha))); equipo.append(nodo('small', row.sede));
      const gravedad = nodo('td'), estado = nodo('td');
      const clase = row.gravedad.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      gravedad.append(nodo('span', row.gravedad, `badge severity-${clase}`));
      estado.append(nodo('span', row.estado, `badge ${row.estado === 'Bloqueado' ? 'state-bloqueado' : row.estado === 'En investigación' ? 'state-investigacion' : ''}`));
      tr.append(id, nodo('td', row.tipo), nodo('td', row.origen), equipo, gravedad, estado); return tr;
    }));
    if (!rows.length) { const tr = nodo('tr'), td = nodo('td', 'No hay incidentes para estos filtros.'); td.colSpan = 6; tr.append(td); $('incidentes').append(tr); }
    $('pagina').textContent = `Página ${pagina + 1} de ${Math.max(1, Math.ceil(datos.total / 12))}`;
    $('anterior').disabled = pagina === 0;
    $('siguiente').disabled = (pagina + 1) * 12 >= datos.total;
    $('conteo').textContent = `${datos.total} EVENTOS`;
  }
  async function cargar() {
    const actual = ++solicitud;
    $('panel').setAttribute('aria-busy', 'true'); $('exportar').disabled = true;
    $('estado').textContent = 'Cargando muestra…';
    try {
      const response = await fetch(`/admin/ciberseguridad/datos?${new URLSearchParams({ dias: $('periodo').value, gravedad: $('gravedad').value })}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('No se pudo cargar el panel. Revise su sesión y vuelva a cambiar un filtro para reintentar.');
      const result = await response.json();
      if (actual !== solicitud) return;
      datos = result; pagina = 0;
      ['total', 'bloqueados', 'pendientes', 'criticos'].forEach(id => { $(id).textContent = datos[id].toLocaleString('es-CR'); });
      $('porcentaje').textContent = `${datos.total ? (datos.bloqueados / datos.total * 100).toFixed(1) : '0'}% de los eventos detectados`;
      $('rango').textContent = `${datos.periodo.desde.split('-').reverse().join('/')} — ${datos.periodo.hasta.split('-').reverse().join('/')} · Datos simulados`;
      graficar(); tabla(); $('exportar').disabled = false;
      $('estado').textContent = `Muestra cargada · ${datos.total} eventos · Gravedad: ${$('gravedad').value}`;
    } catch (error) {
      if (actual !== solicitud) return;
      $('estado').textContent = error.message;
    } finally { if (actual === solicitud) $('panel').setAttribute('aria-busy', 'false'); }
  }
  $('periodo').addEventListener('change', cargar); $('gravedad').addEventListener('change', cargar);
  $('anterior').addEventListener('click', () => { if (pagina > 0) { pagina--; tabla(); } });
  $('siguiente').addEventListener('click', () => { if (datos && (pagina + 1) * 12 < datos.total) { pagina++; tabla(); } });
  $('exportar').addEventListener('click', () => {
    if (!datos) return;
    const filas = [['DATOS SIMULADOS - NO SON ATAQUES REALES'], ['ID', 'Fecha (Costa Rica)', 'Tipo', 'IP de ejemplo', 'Equipo', 'Área', 'Gravedad', 'Estado'],
      ...datos.incidentes.map(r => [r.id, fecha(r.fecha), r.tipo, r.origen, r.equipo, r.sede, r.gravedad, r.estado])];
    const csv = '\uFEFF' + filas.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = nodo('a'); a.href = url; a.download = `ciberseguridad-EJEMPLO-${datos.periodo.desde}-${datos.periodo.hasta}.csv`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  cargar();
})();
