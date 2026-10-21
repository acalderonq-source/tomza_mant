(() => {
  const base = '/admin/ventas-gas/captura-diaria';
  const $ = id => document.getElementById(id);
  const csrf = () => document.querySelector('meta[name="csrf-token"]').content;
  const fmt = (v, d = 2) => v == null ? '—' : Number(v).toLocaleString('es-CR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const el = (tag, props = {}, ...children) => { const n = Object.assign(document.createElement(tag), props); n.append(...children.filter(c => c != null)); return n; };
  let view = JSON.parse($('cd-state').textContent);
  let busy = false;

  // Acepta 15814351.82, 15.814.351,82 o 15 814 351,82.
  function parseAmount(text) {
    let s = String(text || '').replace(/[₡\s]/g, '');
    if (!s) return '';
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
    const n = Number(s);
    if (!Number.isFinite(n)) throw new Error(`Monto inválido: ${text}`);
    return n;
  }
  function showError(message) { $('cd-error').textContent = message || ''; $('cd-error').classList.toggle('d-none', !message); }
  async function call(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf(), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({ error: 'El servidor no pudo procesar la solicitud.' }));
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.');
    return data;
  }

  function render(next) {
    view = next;
    const month = $('cd-month'); month.replaceChildren();
    for (const m of view.months) month.append(el('option', { value: m, textContent: m, selected: m === view.month }));
    $('cd-download').href = `${base}/descargar?month=${encodeURIComponent(view.month)}`;
    const tpl = view.plantillas || {};
    $('cd-templates-status').className = 'badge ms-2 ' + (tpl.ready ? 'bg-success' : 'bg-danger');
    $('cd-templates-status').textContent = tpl.ready ? `Listas (${tpl.source})` : `Faltan (${(tpl.present || []).length} de ${(tpl.required || []).length})`;
    $('cd-templates-list').textContent = (tpl.required || []).join(', ');
    if (!tpl.ready) $('cd-templates-box').open = true;
    $('cd-saldo-gt').value = view.saldos?.GT ?? '';
    $('cd-saldo-sg').value = view.saldos?.SG ?? '';
    const body = $('cd-days'); body.replaceChildren();
    for (const d of view.days) {
      const r = d.reporte;
      const gt = el('input', { className: 'form-control form-control-sm cd-input', inputMode: 'decimal', value: d.cobranza?.GT ?? '' });
      const sg = el('input', { className: 'form-control form-control-sm cd-input', inputMode: 'decimal', value: d.cobranza?.SG ?? '' });
      const save = el('button', { className: 'btn btn-sm btn-outline-primary', type: 'button', textContent: 'Guardar' });
      save.addEventListener('click', () => saveCobranza(d.day, gt.value, sg.value, save));
      const ref = d.referencia && r ? el('div', { className: 'small ' + (Math.abs(d.referencia.kg - r.kg) > 0.05 ? 'text-danger' : 'text-success'), textContent: `Captura General: ${fmt(d.referencia.kg)} kg` }) : null;
      const row = el('tr', { className: r && !d.cobranza ? 'cd-pend' : '' },
        el('td', { textContent: d.day }),
        el('td', {}, r ? el('span', { textContent: `${r.filename} · ${r.documentos} facturas` }) : el('span', { className: 'text-secondary', textContent: '—' }), ref),
        el('td', { className: 'cd-num', textContent: r ? fmt(r.kg) : '—' }),
        el('td', { className: 'cd-num', textContent: r ? fmt(r.gross) : '—' }),
        el('td', { className: 'cd-num', textContent: r ? fmt(r.discount) : '—' }),
        el('td', {}, gt), el('td', {}, sg), el('td', {}, save));
      body.append(row);
    }
  }

  function renderCheck(check) {
    const box = $('cd-check'); box.replaceChildren(); box.classList.remove('d-none');
    const days = check.summary.days.filter(d => d.fuente === 'Reporte General');
    const card = el('section', { className: 'card p-3 mb-3' }, el('h2', { className: 'h6', textContent: `Revisión de ${check.month}` }));
    if (check.warnings.length) card.append(el('div', { className: 'alert alert-warning' }, el('strong', { textContent: 'Revisar: ' }), el('ul', { className: 'mb-0' }, ...check.warnings.map(w => el('li', { textContent: w })))));
    else card.append(el('div', { className: 'alert alert-success', textContent: 'Todo cuadra: cada captura suma lo mismo que el Reporte General.' }));
    if (check.notes.length) card.append(el('div', { className: 'alert alert-info small' }, el('ul', { className: 'mb-0' }, ...check.notes.map(w => el('li', { textContent: w })))));
    if (days.length) {
      const head = el('tr', {}, el('th', { textContent: 'Fecha' }), ...days[0].captures.map(c => el('th', { className: 'cd-num', textContent: c.name })), el('th', { className: 'cd-num', textContent: 'General (kg)' }));
      const rows = days.map(d => el('tr', {}, el('td', { textContent: d.day }),
        ...d.captures.map(c => el('td', { className: 'cd-num ' + (c.expected != null && Math.abs(c.kg - c.expected) > 0.05 ? 'text-danger' : ''), textContent: fmt(c.kg) })),
        el('td', { className: 'cd-num fw-bold', textContent: fmt(d.kg) })));
      card.append(el('div', { className: 'table-responsive' }, el('table', { className: 'table table-sm' }, el('thead', {}, head), el('tbody', {}, ...rows))));
    }
    const s = check.summary.saldoFinal;
    card.append(el('p', { className: 'small mb-0', textContent: `Saldo final de cartera del mes — Gas Tomza ₡${fmt(s.GT)} · Super Gas ₡${fmt(s.SG)} · General ₡${fmt(s.GENERAL)}` }));
    box.append(card);
  }

  async function saveCobranza(day, gt, sg, button) {
    if (busy) return; showError('');
    try {
      busy = true; button.disabled = true;
      const data = await call(`${base}/cobranza`, { method: 'POST', body: JSON.stringify({ day, GT: parseAmount(gt), SG: parseAmount(sg), revision: view.revision }) });
      render(data.view);
    } catch (e) { showError(e.message); } finally { busy = false; button.disabled = false; }
  }

  const readFile = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}`));
    reader.onload = () => resolve({ filename: file.name, content: String(reader.result).split(',')[1] || '' });
    reader.readAsDataURL(file);
  });

  $('cd-upload').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return; showError('');
    const files = [...$('cd-files').files];
    if (!files.length || files.length > 5 || files.reduce((s, f) => s + f.size, 0) > 7 * 1024 * 1024) { showError('Seleccione el Reporte General (máximo 5 archivos y 7 MB).'); return; }
    busy = true; $('cd-submit').disabled = true; $('cd-progress').textContent = 'Leyendo el reporte y llenando las capturas… (puede tardar unos segundos)';
    try {
      const data = await call(`${base}/importar`, { method: 'POST', body: JSON.stringify({ revision: view.revision, files: await Promise.all(files.map(readFile)) }) });
      render(data.view); renderCheck(data.check); $('cd-files').value = ''; $('cd-progress').textContent = 'Listo. Revise abajo y digite la cobranza.';
    } catch (e) { showError(e.message); $('cd-progress').textContent = ''; }
    finally { busy = false; $('cd-submit').disabled = false; }
  });

  $('cd-month').addEventListener('change', async () => {
    showError('');
    try { render(await call(`${base}/api?month=${encodeURIComponent($('cd-month').value)}`, { headers: {} })); $('cd-check').classList.add('d-none'); } catch (e) { showError(e.message); }
  });

  $('cd-review').addEventListener('click', async () => {
    showError(''); $('cd-review-progress').textContent = 'Revisando…';
    try { renderCheck(await call(`${base}/revisar?month=${encodeURIComponent(view.month)}`)); $('cd-review-progress').textContent = ''; }
    catch (e) { showError(e.message); $('cd-review-progress').textContent = ''; }
  });

  $('cd-saldo').addEventListener('submit', async event => {
    event.preventDefault(); showError('');
    try {
      const data = await call(`${base}/saldo`, { method: 'POST', body: JSON.stringify({ month: view.month, GT: parseAmount($('cd-saldo-gt').value), SG: parseAmount($('cd-saldo-sg').value), revision: view.revision }) });
      render(data.view);
    } catch (e) { showError(e.message); }
  });

  $('cd-templates').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return; showError('');
    const files = [...$('cd-templates-files').files];
    if (!files.length || files.length > 11) { showError('Seleccione los 11 archivos .xlsx de plantilla.'); return; }
    busy = true; $('cd-templates-progress').textContent = 'Subiendo…';
    try {
      const data = await call(`${base}/plantillas`, { method: 'POST', body: JSON.stringify({ month: view.month, files: await Promise.all(files.map(readFile)) }) });
      render(data.view); $('cd-templates-files').value = ''; $('cd-templates-progress').textContent = 'Plantillas guardadas.';
    } catch (e) { showError(e.message); $('cd-templates-progress').textContent = ''; }
    finally { busy = false; }
  });

  render(view);
})();
