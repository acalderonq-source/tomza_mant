(() => {
  'use strict';
  const base = '/admin/informes-junta', $ = selector => document.querySelector(selector);
  let report, manifest, suggested = [], pending = false, edits = { cells: {}, texts: {}, images: {} }, paramsDirty = false, saving = false;
  const fmt = value => Number(value).toLocaleString('es-CR', { maximumFractionDigits: 2 });
  function message(text, error = false) { const box = $('#ij-message'); box.textContent = text; box.hidden = false; box.classList.toggle('error', error); }
  async function request(url, options = {}) {
    const response = await fetch(base + url, { ...options, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json', 'x-csrf-token': $('meta[name="csrf-token"]').content } : {}) } });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'No se pudo cargar la plantilla.'); }
    return response.json();
  }
  function markDirty(value = true) {
    pending = value;
    window.dispatchEvent(new CustomEvent('ij:template-dirty', { detail: value }));
    $('#ij-template-status').textContent = value ? 'Hay cambios sin guardar en la plantilla.' : `${Object.keys(edits.cells).length} celdas, ${Object.keys(edits.texts).length} textos y ${Object.keys(edits.images).length} imágenes guardados. El resto conserva sus datos originales.`;
  }
  function element(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
  function renderCells() {
    if (!manifest) return;
    const sheet = manifest.sheets.find(s => s.id === $('#ij-template-sheet').value);
    const table = document.createElement('table'), head = table.createTHead().insertRow();
    ['Celda', 'Descripción', 'Valor original', 'Valor de la copia'].forEach(text => head.append(element('th', text)));
    const body = table.createTBody();
    for (const cell of sheet.cells) {
      const key = `${sheet.id}:${cell.coordinate}`, row = body.insertRow();
      row.insertCell().textContent = cell.coordinate; row.insertCell().textContent = cell.label;
      row.insertCell().textContent = fmt(cell.value);
      const input = element('input'); input.type = 'number'; input.step = 'any'; input.min = '-1000000000000'; input.max = '1000000000000'; input.value = edits.cells[key] ?? cell.value; input.setAttribute('aria-label', `${sheet.name} ${cell.coordinate}`);
      input.addEventListener('input', () => {
        input.setCustomValidity('');
        if (input.value === '' || !input.validity.valid) { input.setCustomValidity('Ingresá un número válido.'); markDirty(); return; }
        const value = Number(input.value); if (value === cell.value) delete edits.cells[key]; else edits.cells[key] = value; markDirty();
      });
      row.insertCell().append(input);
    }
    if (!sheet.cells.length) { const cell = body.insertRow().insertCell(); cell.colSpan = 4; cell.textContent = 'Esta hoja no contiene valores numéricos directos para editar. Sus fórmulas y formato se conservan.'; }
    $('#ij-template-cells').replaceChildren(table);
  }
  function renderSlide() {
    if (!manifest) return;
    const slide = manifest.slides.find(s => s.number === Number($('#ij-template-slide').value));
    $('#ij-template-texts').replaceChildren(...slide.texts.map(text => {
      const key = `${slide.number}:${text.index}`, label = element('label', `Texto ${text.index + 1}`), input = element('input');
      input.value = edits.texts[key] ?? text.value; input.maxLength = 180;
      input.addEventListener('input', () => { if (input.value === text.value) delete edits.texts[key]; else edits.texts[key] = input.value; markDirty(); });
      label.append(input); return label;
    }));
    $('#ij-template-images').replaceChildren(...slide.images.map(image => {
      const block = element('section', null, 'ij-template-image');
      block.append(element('h3', `Bloque de datos · ${image.name}`));
      const img = element('img'); img.src = edits.images[image.name] ? 'data:image/png;base64,' + edits.images[image.name] : `${base}/api/plantillas/imagen/${image.name}`; img.alt = `Bloque original de la diapositiva ${slide.number}`;
      block.append(img, element('p', `Reemplazo PNG de ${image.width} × ${image.height} px. Se mantienen su posición, tamaño y recorte originales. Las cifras dentro de la imagen no son texto editable.`));
      const actions = element('div', null, 'ij-actions'), original = element('a', 'Descargar bloque original', 'ij-btn ij-btn-outline'); original.href = `${base}/api/plantillas/imagen/${image.name}`; original.download = image.name;
      const upload = element('label', 'Reemplazar bloque PNG', 'ij-btn ij-btn-outline'), input = element('input'); input.type = 'file'; input.accept = '.png';
      input.addEventListener('change', async () => {
        const file = input.files[0]; if (!file) return;
        try {
          if (file.size > 3 * 1024 * 1024 || !/\.png$/i.test(file.name)) throw new Error('Usá un PNG de hasta 3 MB.');
          const content = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
          const loaded = new Image(); await new Promise((resolve, reject) => { loaded.onload = resolve; loaded.onerror = () => reject(new Error('PNG inválido.')); loaded.src = content; });
          if (loaded.naturalWidth !== image.width || loaded.naturalHeight !== image.height) throw new Error(`El bloque debe medir exactamente ${image.width} × ${image.height} px.`);
          edits.images[image.name] = content.split(',')[1]; markDirty(); renderSlide();
        } catch (error) { message(error.message || 'No se pudo leer el PNG.', true); }
      });
      upload.append(input); actions.append(original, upload);
      if (edits.images[image.name]) { const reset = element('button', 'Restaurar bloque original', 'ij-btn ij-btn-outline'); reset.addEventListener('click', () => { delete edits.images[image.name]; markDirty(); renderSlide(); }); actions.append(reset); }
      block.append(actions); return block;
    }));
    if (!slide.images.length) $('#ij-template-images').append(element('p', 'Esta diapositiva no tiene bloques PNG de datos para reemplazar. Sus gráficos, objetos incrustados y fondos permanecen intactos.'));
  }
  async function load(current) {
    const keepEdits = pending && report?.id === current.id;
    report = current;
    if (!keepEdits) { edits = structuredClone(current.templateEdits || { cells: {}, texts: {}, images: {} }); markDirty(false); }
    try {
      manifest ||= await request('/api/plantillas');
      if (report.id !== current.id) return;
      if (!$('#ij-template-sheet').options.length) $('#ij-template-sheet').replaceChildren(...manifest.sheets.map(sheet => { const option = element('option', sheet.name); option.value = sheet.id; return option; }));
      if (!$('#ij-template-slide').options.length) $('#ij-template-slide').replaceChildren(...manifest.slides.map(slide => { const option = element('option', `${slide.number}. ${slide.texts.map(text => text.value).filter(Boolean).join(' · ').slice(0, 85)}`); option.value = slide.number; return option; }));
      renderCells(); renderSlide();
      const result = await request(`/api/informes/${current.id}/sugerencias`);
      if (report.id !== current.id) return;
      suggested = result;
      $('#ij-template-suggestions').replaceChildren(...suggested.map(item => element('p', `${item.label}: ${fmt(item.original)} → ${fmt(item.value)}`)));
      if (!suggested.length) $('#ij-template-suggestions').append(element('p', 'No hay celdas vinculadas automáticamente para esta fuente o período. Podés editar las celdas manualmente.'));
      $('#ij-template-apply').disabled = !suggested.length;
    } catch (error) { message(error.message, true); }
  }
  $('#ij-template-sheet').addEventListener('change', renderCells); $('#ij-template-slide').addEventListener('change', renderSlide);
  $('#ij-template-apply').addEventListener('click', () => { for (const item of suggested) edits.cells[item.key] = item.value; markDirty(); renderCells(); message('Valores seleccionados como ajustes fijos. El relleno de Excel y PPT ya se realiza automáticamente al descargar.'); });
  $('#ij-template-save').addEventListener('click', async () => {
    if (!report || saving) return;
    if (paramsDirty) { message('Guardá primero los parámetros de Revisar datos. Luego guardá la plantilla.', true); return; }
    if ([...$('#ij-template-cells').querySelectorAll('input')].some(input => !input.reportValidity())) return;
    saving = true; window.dispatchEvent(new CustomEvent('ij:template-busy', { detail: true })); $('#ij-template-save').disabled = true;
    try {
      const saved = await request(`/api/informes/${report.id}/plantilla`, { method: 'PUT', body: JSON.stringify({ revision: report.revision, edits }) });
      pending = false; window.dispatchEvent(new CustomEvent('ij:template-saved', { detail: saved }));
    } catch (error) { message(error.message, true); }
    finally { saving = false; window.dispatchEvent(new CustomEvent('ij:template-busy', { detail: false })); $('#ij-template-save').disabled = false; }
  });
  window.addEventListener('ij:params-dirty', event => { paramsDirty = event.detail; });
  window.addEventListener('ij:report', event => load(event.detail));
})();
