(() => {
  'use strict';
  const base = '/admin/informes-junta';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const fmt = value => value == null ? 'Sin datos' : Number(value).toLocaleString('es-CR', { maximumFractionDigits: 2 });
  let report = null, dirty = false, templateDirty = false, busy = false, currentView = 'cargar';
  const titles = {
    cargar: ['Cargar información', 'Importá la exportación del sistema para preparar el informe mensual.'],
    validar: ['Revisar información', 'Compará los totales y editá los parámetros antes de generar el informe.'],
    plantillas: ['Plantillas originales', 'Editá el contenido dentro de tus mismos formatos, sin reconstruir la presentación.'],
    resumen: ['Resumen del mes', 'Resultados calculados desde la fuente cargada.'],
    generar: ['Generar informe', 'Un mismo cierre para Excel y PowerPoint.'],
    historial: ['Historial de informes', 'Reabrí tus pruebas para editarlas y volver a descargar los archivos.']
  };
  function message(text, error = false) { const node = $('#ij-message'); node.textContent = text; node.classList.toggle('error', error); node.hidden = false; }
  function setBusy(value) { busy = value; $$('button').forEach(button => { button.disabled = value; }); $('#ij-file').disabled = value; document.body.setAttribute('aria-busy', String(value)); }
  async function operation(fn) {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (error) { message(error.message || 'No se pudo completar la operación.', true); }
    finally { setBusy(false); }
  }
  async function request(url, options = {}) {
    const headers = { Accept: 'application/json', ...options.headers };
    if (options.body) { headers['Content-Type'] = 'application/json'; headers['x-csrf-token'] = $('meta[name="csrf-token"]').content; }
    const response = await fetch(base + url, { ...options, headers });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || (response.status === 401 ? 'La sesión venció. Iniciá sesión nuevamente.' : `No se pudo completar la operación (${response.status}).`));
    }
    return response.json();
  }
  function switchView(view) {
    if (!titles[view]) return;
    currentView = view;
    $$('[data-panel]').forEach(node => { node.hidden = node.dataset.panel !== view; });
    $$('nav [data-view]').forEach(node => node.classList.toggle('active', node.dataset.view === view));
    $$('[data-step]').forEach(node => node.classList.toggle('active', node.dataset.step === view));
    $('#ij-title').textContent = titles[view][0]; $('#ij-description').textContent = titles[view][1];
    if (view === 'historial') operation(loadHistory);
  }
  function table(container, headers, rows, numericColumns = []) {
    const node = document.createElement('table'), head = node.createTHead(), tr = head.insertRow();
    headers.forEach(label => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; tr.append(th); });
    const body = node.createTBody();
    rows.forEach(cells => {
      const row = body.insertRow();
      cells.forEach((value, index) => { const td = row.insertCell(); if (value instanceof Node) td.append(value); else td.textContent = value ?? '—'; if (numericColumns.includes(index)) td.className = 'num'; });
    });
    if (!rows.length) { const cell = body.insertRow().insertCell(); cell.colSpan = headers.length; cell.textContent = 'Sin registros.'; }
    container.replaceChildren(node);
  }
  function metrics(container, items) {
    container.replaceChildren(...items.map(([label, value, unit, warning]) => {
      const block = document.createElement('div'); block.className = `ij-metric${warning ? ' warning' : ''}`;
      const name = document.createElement('small'); name.textContent = label;
      const strong = document.createElement('strong'); strong.textContent = value;
      const subtitle = document.createElement('small'); subtitle.textContent = unit;
      block.append(name, strong, subtitle); return block;
    }));
  }
  function check(label, result, warning = false) {
    const row = document.createElement('div'); row.className = `ij-check${warning ? ' warn' : ''}`;
    const title = document.createElement('span'), status = document.createElement('span'); title.textContent = label; status.textContent = result; row.append(title, status); return row;
  }
  function renderBreakdown() {
    if (!report) return;
    const s = report.summary;
    table($('#ij-breakdown'), ['Descripción', report.params.period, s.previous, 'Variación', 'Variación %'], s.breakdown[$('#ij-dimension').value].map(row => [row.name, fmt(row.current), fmt(row.previous), fmt(row.difference), row.percent === null ? 'Sin base' : `${fmt(row.percent * 100)}%`]), [1, 2, 3, 4]);
  }
  function render() {
    if (!report) return;
    const { data, params: p, summary: s } = report;
    $$('.ij-empty').forEach(node => { node.hidden = true; }); $$('.ij-loaded').forEach(node => { node.hidden = false; });
    $('#ij-source-preview').hidden = false; $('#ij-source-label').hidden = false;
    $('#ij-source-label').textContent = data.demo ? 'Ejemplo ficticio' : data.filename;
    $('#ij-period').textContent = `${p.period} · Costa Rica`;
    $('#ij-source-count').textContent = `${fmt(data.count)} registros · ${data.records.length} en vista previa`;
    table($('#ij-source-table'), ['Hoja de origen', 'Código', 'Nombre comercial', 'Grupo', 'CC', 'División', 'Canal', ...data.months], data.records.map(row => [row.sourceSheet || data.sheet, row.codigo, row.nombre, row.grupo, row.cc || 'Sin clasificación', row.division, row.canal, ...data.months.map(m => fmt(row.values[m]))]), data.months.map((_, i) => i + 7));
    metrics($('#ij-compare'), [['Total de la fuente', fmt(s.total), p.unit], ['Referencia manual', fmt(p.reference), p.unit], ['Diferencia vs referencia', fmt(s.referenceDifference), p.unit, s.referenceDifference !== null && Math.abs(s.referenceDifference) > 0.01]]);
    $('#ij-validation-banner').textContent = s.referenceDifference !== null && Math.abs(s.referenceDifference) > 0.01 ? 'Hay una diferencia con la referencia manual. Revisá el corte y documentá la explicación en observaciones. Las descargas se identificarán como pruebas parciales.' : 'Fuente cargada. Revisá la unidad y los parámetros. Esta versión genera un informe parcial de ventas.';
    $('#ij-checks').replaceChildren(
      check('Archivo', `${data.filename}${data.demo ? ' · ficticio' : ''}`), check('Registros', fmt(data.count)), check('Período', p.period),
      ...(data.sources || []).map(source => check(`Hoja ${source.sheet}`, `${source.filename} · ${fmt(source.count)} registros`)),
      check('Comparación con mes anterior', s.hasPrevious ? s.previous : 'Falta el mes anterior', !s.hasPrevious),
      check('Valores vacíos tratados como cero', fmt(data.emptyAmounts), data.emptyAmounts > 0),
      check('Claves repetidas conservadas', fmt(data.repeatedKeys || 0), data.repeatedKeys > 0),
      check('Canal sin clasificación en el origen', fmt(data.unclassifiedChannels || 0), data.unclassifiedChannels > 0),
      check('Unidad', p.unit, p.unit === 'Unidad por confirmar'), check('Meta', p.target === null ? 'Pendiente' : fmt(p.target), p.target === null),
      check('Días de operación', p.days === null ? 'Pendiente' : fmt(p.days), p.days === null),
      check('Contabilidad, nómina, cartera y mercado', 'Pendientes de incorporar', true)
    );
    $('#ij-scope').textContent = report.scope;
    const form = $('#ij-params');
    form.elements.period.replaceChildren(...data.months.map(month => { const option = document.createElement('option'); option.value = month; option.textContent = month; return option; }));
    if (![...form.elements.unit.options].some(option => option.value === p.unit)) { const option = document.createElement('option'); option.value = p.unit; option.textContent = p.unit; form.elements.unit.append(option); }
    Object.entries(p).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value ?? ''; });
    dirty = false; $('#ij-save-state').classList.remove('ij-dirty'); $('#ij-save-state').textContent = `Guardado · versión ${report.revision}`;
    window.dispatchEvent(new CustomEvent('ij:params-dirty', { detail: false }));
    metrics($('#ij-summary-metrics'), [['Venta del mes', fmt(s.total), p.unit], ['Variación mensual', s.percent === null ? 'Sin base' : `${fmt(s.percent * 100)}%`, `${s.previous} · ${fmt(s.difference)} ${p.unit}`], ['Promedio diario', fmt(s.daily), p.days ? `${p.days} días de operación` : 'Ingresá los días de operación']]);
    $('#ij-history-unit').textContent = p.unit;
    const max = Math.max(1, ...s.history.map(item => Math.abs(item.total)));
    $('#ij-bars').replaceChildren(...s.history.map(item => {
      const row = document.createElement('div'); row.className = 'ij-bar-row';
      const label = document.createElement('span'); label.textContent = item.period;
      const track = document.createElement('div'); track.className = 'ij-bar-track'; const bar = document.createElement('div'); bar.style.width = `${Math.abs(item.total) / max * 100}%`; if (item.total < 0) bar.style.background = '#ac7019'; track.append(bar);
      const value = document.createElement('strong'); value.textContent = fmt(item.total); row.append(label, track, value); return row;
    }));
    renderBreakdown();
    $('#ij-export-notice').textContent = report.scope;
    $('#ij-excel-title').textContent = 'Informe Junta México · relleno automático';
    table($('#ij-excel-preview'), ['Celda modificada', 'Nuevo valor'], Object.entries(report.templateEdits?.cells || {}).map(([key, value]) => [key, fmt(value)]), [1]);
    $('#ij-ppt-title').textContent = 'PPT original · datos rellenados automáticamente'; $('#ij-ppt-period').textContent = 'Se actualizan los números dentro de las mismas tablas, sin cambiar sus posiciones.';
    $('#ij-version').textContent = `Versión ${report.revision} · ${Object.keys(report.templateEdits?.cells || {}).length} celdas, ${Object.keys(report.templateEdits?.texts || {}).length} textos y ${Object.keys(report.templateEdits?.images || {}).length} imágenes modificados.`;
    window.dispatchEvent(new CustomEvent('ij:report', { detail: report }));
  }
  async function importFiles(selected) {
    const files = [...selected];
    if (!files.length) return;
    if (files.length > 10 || files.some(file => !/\.xlsx$/i.test(file.name)) || files.reduce((sum, file) => sum + file.size, 0) > 6 * 1024 * 1024) throw new Error('Seleccioná hasta 10 archivos .xlsx de un máximo total de 6 MB.');
    if ((dirty || templateDirty) && !window.confirm('Tenés cambios sin guardar. ¿Cargar otro informe y descartarlos?')) return;
    message(`Leyendo ${files.map(file => file.name).join(' + ')}…`);
    const payload = await Promise.all(files.map(async file => ({ filename: file.name, content: await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('No se pudo leer el archivo.')); reader.readAsDataURL(file); }) })));
    report = await request('/api/importar', { method: 'POST', body: JSON.stringify({ files: payload }) });
    render(); message(`${report.data.filename} cargado: ${fmt(report.data.count)} registros. Revisá el mes, la unidad y los parámetros.`);
  }
  async function save() {
    if (!report) throw new Error('Cargá una fuente primero.');
    const form = $('#ij-params');
    if (!form.reportValidity()) throw new Error('Revisá los parámetros indicados.');
    const params = Object.fromEntries(new FormData(form));
    report = await request(`/api/informes/${report.id}`, { method: 'PUT', body: JSON.stringify({ revision: report.revision, params }) });
    render(); message('Cambios guardados. Excel y PPT se rellenarán automáticamente al descargar.');
  }
  async function download(extension) {
    if (!report) throw new Error('Cargá una fuente primero.');
    if (dirty || templateDirty) throw new Error('Guardá los parámetros y los cambios de plantilla antes de descargar.');
    message(`Generando ${extension === 'xlsx' ? 'Excel' : 'PowerPoint'}…`);
    const response = await fetch(`${base}/api/informes/${report.id}/descargar.${extension}`);
    if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || 'No se pudo generar el archivo.'); }
    const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `${report.data.demo?'DEMO-':''}Informe-relleno-${report.params.period}-v${report.revision}.${extension}`; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    message(`${extension === 'xlsx' ? 'Excel' : 'PowerPoint'} generado. Si el navegador bloquea descargas múltiples, usá los botones individuales.`);
  }
  async function loadHistory() {
    const records = await request('/api/informes');
    table($('#ij-history'), ['Informe', 'Período', 'Fuente', 'Último cambio', ''], records.map(item => {
      const open = document.createElement('button'); open.className = 'ij-btn ij-btn-outline'; open.textContent = 'Abrir y editar';
      open.addEventListener('click', () => operation(async () => {
        if ((dirty || templateDirty) && !window.confirm('Tenés cambios sin guardar. ¿Descartarlos y abrir otro informe?')) return;
        report = await request(`/api/informes/${item.id}`); render(); switchView('validar'); message('Informe abierto. Podés editar los parámetros.');
      }));
      return [`${item.params.title}${item.demo ? ' · ficticio' : ''}`, item.params.period, `${item.filename} · ${fmt(item.count)} registros`, new Date(item.updatedAt).toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' }), open];
    }));
  }
  $$('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
  $('#ij-file').addEventListener('change', event => { const files = [...event.target.files]; operation(async () => { try { await importFiles(files); } finally { event.target.value = ''; } }); });
  const drop = $('#ij-drop');
  ['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('dragging'); }));
  drop.addEventListener('drop', event => { const files = [...event.dataTransfer.files]; operation(() => importFiles(files)); });
  $('#ij-demo').addEventListener('click', () => operation(async () => { if ((dirty || templateDirty) && !window.confirm('¿Descartar cambios sin guardar y cargar el ejemplo?')) return; report = await request('/api/demo', { method: 'POST', body: '{}' }); render(); message('Ejemplo ficticio cargado. Las descargas usan tus formatos originales; aplicá los cambios desde Plantillas originales.'); }));
  $('#ij-params').addEventListener('input', () => { dirty = true; window.dispatchEvent(new CustomEvent('ij:params-dirty', { detail: true })); $('#ij-save-state').textContent = 'Cambios sin guardar. Guardalos antes de descargar.'; $('#ij-save-state').classList.add('ij-dirty'); });
  $('#ij-params').addEventListener('submit', event => { event.preventDefault(); operation(save); });
  $('#ij-dimension').addEventListener('change', renderBreakdown);
  $$('[data-download]').forEach(button => button.addEventListener('click', () => operation(() => download(button.dataset.download))));
  $('#ij-download-all').addEventListener('click', () => operation(async () => { await download('xlsx'); await download('pptx'); }));
  $('#ij-refresh').addEventListener('click', () => operation(loadHistory));
  window.addEventListener('ij:template-dirty', event => { templateDirty = event.detail; });
  window.addEventListener('ij:template-busy', event => setBusy(event.detail));
  window.addEventListener('ij:template-saved', event => { report = event.detail; templateDirty = false; render(); message('Plantilla guardada. Se conserva el formato original.'); });
  window.addEventListener('beforeunload', event => { if (dirty || templateDirty) { event.preventDefault(); event.returnValue = ''; } });
  switchView(currentView);
})();
