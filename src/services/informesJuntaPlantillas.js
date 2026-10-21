const fs = require('node:fs/promises');
const path = require('node:path');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const { buildAutomatic, overlays, dateLabel } = require('./informesJuntaAutomaticos');
const { isError } = require('./informesJuntaCalculos');
const { embedLato } = require('./informesJuntaFuentes');

const ROOT = path.join(__dirname, '../templates/informes-junta');
const FILES = { xlsx: 'informe-original.xlsx', pptx: 'presentacion-original.pptx' };
const error = message => Object.assign(new Error(message), { status: 400 });
const xml = text => new DOMParser().parseFromString(text, 'application/xml');
const nodes = (doc, tag) => [...doc.getElementsByTagName(tag)];
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let cached;
async function template(extension) {
  if (!FILES[extension]) throw error('Plantilla inválida.');
  return fs.readFile(path.join(ROOT, FILES[extension]));
}
function pngSize(buffer) {
  if (buffer.length < 33 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || buffer.toString('ascii', 12, 16) !== 'IHDR' || !buffer.includes(Buffer.from('IEND'))) throw error('Seleccioná una imagen PNG válida.');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
async function manifest() {
  if (cached) return cached;
  const ppt = await JSZip.loadAsync(await template('pptx')), excel = await JSZip.loadAsync(await template('xlsx'));
  const slides = [];
  for (let number = 1; number <= 29; number++) {
    const doc = xml(await ppt.file(`ppt/slides/slide${number}.xml`).async('string'));
    const texts = nodes(doc, 'a:t').map((node, index) => ({ index, value: node.textContent }));
    const relPath = `ppt/slides/_rels/slide${number}.xml.rels`, images = [];
    const rels = xml(await ppt.file(relPath).async('string'));
    for (const rel of nodes(rels, 'Relationship')) {
      const target = rel.getAttribute('Target');
      if (!/^\.\.\/media\/image(?:[3-9]|[1-9]\d+)\.png$/.test(target)) continue;
      const name = path.posix.basename(target), buffer = await ppt.file(`ppt/media/${name}`).async('nodebuffer');
      images.push({ name, ...pngSize(buffer) });
    }
    slides.push({ number, texts, images });
  }
  const book = xml(await excel.file('xl/workbook.xml').async('string'));
  const relationships = xml(await excel.file('xl/_rels/workbook.xml.rels').async('string'));
  const relMap = Object.fromEntries(nodes(relationships, 'Relationship').map(node => [node.getAttribute('Id'), node.getAttribute('Target')]));
  const strings = excel.file('xl/sharedStrings.xml') ? nodes(xml(await excel.file('xl/sharedStrings.xml').async('string')), 'si').map(node => node.textContent) : [];
  const sheets = [];
  for (const sheet of nodes(book, 'sheet')) {
    const target = relMap[sheet.getAttribute('r:id')];
    const zipPath = target.startsWith('/') ? target.slice(1) : path.posix.normalize('xl/' + target);
    const doc = xml(await excel.file(zipPath).async('string')), cells = [];
    for (const cell of nodes(doc, 'c')) {
      if (nodes(cell, 'f').length) continue; // Preserve existing formulas.
      const value = nodes(cell, 'v')[0]?.textContent;
      if (value == null || cell.getAttribute('t') === 's' || cell.getAttribute('t') === 'e' || cell.getAttribute('t') === 'b') continue;
      if (!Number.isFinite(Number(value))) continue;
      const coordinate = cell.getAttribute('r');
      const row = cell.parentNode;
      const labels = nodes(row, 'c').filter(c => c.getAttribute('t') === 's').map(c => strings[Number(nodes(c, 'v')[0]?.textContent)]).filter(Boolean);
      cells.push({ coordinate, value: Number(value), label: labels.join(' · ').slice(0, 150) });
    }
    sheets.push({ name: sheet.getAttribute('name'), id: sheet.getAttribute('sheetId'), zipPath, cells });
  }
  cached = { slides, sheets }; return cached;
}
async function validateEdits(input) {
  const m = await manifest();
  if (!input || typeof input !== 'object') throw error('Cambios de plantilla inválidos.');
  const edits = { cells: {}, texts: {}, images: {} };
  for (const category of Object.keys(edits)) {
    const values = input[category] || {};
    if (!values || Array.isArray(values) || typeof values !== 'object' || Object.keys(values).length > 2000) throw error('Demasiados cambios en la plantilla.');
    for (const [key, value] of Object.entries(values)) {
      if (category === 'cells') {
        const [sheetId, coordinate] = key.split(':');
        if (!m.sheets.find(s => s.id === sheetId)?.cells.some(c => c.coordinate === coordinate) || typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) throw error('Celda de plantilla inválida. Solo se pueden editar valores numéricos existentes.');
      } else if (category === 'texts') {
        const [slide, index] = key.split(':').map(Number);
        if (!m.slides.find(s => s.number === slide)?.texts.some(t => t.index === index) || typeof value !== 'string' || value.length > 180) throw error('Texto de diapositiva inválido (máximo 180 caracteres).');
      } else {
        const image = m.slides.flatMap(s => s.images).find(i => i.name === key);
        if (!image || typeof value !== 'string' || value.length > 4 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw error('Imagen de plantilla inválida (máximo 3 MB).');
        const size = pngSize(Buffer.from(value, 'base64'));
        if (size.width !== image.width || size.height !== image.height) throw error(`La imagen debe medir exactamente ${image.width} × ${image.height} px para conservar el formato.`);
      }
      edits[category][key] = value;
    }
  }
  if (JSON.stringify(edits).length > 8 * 1024 * 1024) throw error('El conjunto de cambios supera 8 MB.');
  return edits;
}
function applyCell(content, entry, automatic) {
  const { address, value, sheet } = entry;
  const pattern = new RegExp(`<c\\b[^>]*?\\br="${address}"[^>]*?(?:\\s*\\/>|>[\\s\\S]*?<\\/c>)`);
  const previous = content.match(pattern)?.[0];
  const start = previous ? previous.match(/^<c\b[^>]*>/)[0].replace(/\s+t="[^"]*"/g, '').replace(/\s*\/>$/, '>') : `<c r="${address}">`;
  const key = `${sheet}!${address}`, formula = automatic.formulas.get(key);
  const previousFormula = previous?.match(/<f\b[^>]*?(?:\s*\/>|>[\s\S]*?<\/f>)/)?.[0] || '';
  const formulaXml = formula ? `<f>${escape(formula)}</f>` : automatic.model.overrides.has(key) ? '' : previousFormula;
  const type = isError(value) ? 'e' : typeof value === 'number' ? 'n' : formulaXml ? 'str' : 'inlineStr';
  const payload = isError(value) ? `<v>${escape(value.error)}</v>` : typeof value === 'number' ? `<v>${value}</v>` : formulaXml ? `<v>${escape(value ?? '')}</v>` : `<is><t xml:space="preserve">${escape(value ?? '')}</t></is>`;
  const replacement = start.replace(/>$/, ` t="${type}">`) + formulaXml + payload + '</c>';
  if (previous) return content.replace(previous, () => replacement);
  const row = Number(address.replace(/[A-Z]/g, '')), rowPattern = new RegExp(`<row\\b[^>]*\\br="${row}"[^>]*>[\\s\\S]*?<\\/row>`);
  const rowXml = content.match(rowPattern)?.[0];
  if (!rowXml) throw error(`No existe la fila ${row} en ${sheet}.`);
  // New inputs are inserted in column order without touching row formatting.
  const column = address.match(/[A-Z]+/)[0], order = text => [...text].reduce((sum,c)=>sum*26+c.charCodeAt(0)-64,0);
  const next = [...rowXml.matchAll(/<c\b[^>]*?\br="([A-Z]+)\d+"[^>]*?(?:\s*\/>|>[\s\S]*?<\/c>)/g)].find(match => order(match[1]) > order(column));
  const updated = next ? rowXml.slice(0,next.index) + replacement + rowXml.slice(next.index) : rowXml.replace('</row>', replacement + '</row>');
  return content.replace(rowXml, () => updated);
}
function numericShape(id, cell, transform, width, height, crop = {}) {
  const left = Number(crop.l || 0) / 100000 * width, top = Number(crop.t || 0) / 100000 * height;
  const sx = transform.cx / (width * (1 - (Number(crop.l || 0) + Number(crop.r || 0)) / 100000));
  const sy = transform.cy / (height * (1 - (Number(crop.t || 0) + Number(crop.b || 0)) / 100000));
  const x = Math.round(transform.x + (cell.x + 1 - left) * sx), y = Math.round(transform.y + (cell.y + 1 - top) * sy);
  const w = Math.round((cell.w - 2) * sx), h = Math.round((cell.h - 2) * sy), size = Math.max(500, Math.round(cell.fontPx * sy / 127));
  const align = cell.align === 'center' ? 'ctr' : cell.align === 'right' ? 'r' : 'l';
  const margin = Math.round(Math.min(7,cell.w*0.05)*sx);
  const attribute = value => escape(value).replace(/"/g,'&quot;');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${attribute('AUTO '+cell.sheet+'!'+cell.address)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${cell.fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="${margin}" rIns="${margin}" tIns="0" bIns="0" anchor="ctr"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="${align}"/><a:r><a:rPr lang="es-CR" sz="${size}" b="${cell.bold?1:0}" i="${cell.italic?1:0}" dirty="0"><a:solidFill><a:srgbClr val="${cell.color}"/></a:solidFill><a:latin typeface="${attribute(cell.font)}"/><a:ea typeface="${attribute(cell.font)}"/><a:cs typeface="${attribute(cell.font)}"/></a:rPr><a:t xml:space="preserve">${escape(cell.text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
}
async function fillSlides(zip, automatic, edits, m) {
  const blocks = await overlays(automatic);
  for (const block of blocks) {
    if (edits.images?.[block.image]) continue; // Explicit custom blocks take precedence.
    const slidePath = `ppt/slides/slide${block.slide}.xml`, original = await zip.file(slidePath).async('string'), doc = xml(original);
    const rels = xml(await zip.file(`ppt/slides/_rels/slide${block.slide}.xml.rels`).async('string'));
    const rel = nodes(rels,'Relationship').find(node=>node.getAttribute('Target')===`../media/${block.image}`);
    const pic = nodes(doc,'p:pic').find(node=>nodes(node,'a:blip')[0]?.getAttribute('r:embed')===rel?.getAttribute('Id'));
    if (!pic) throw error(`No se encontró el bloque ${block.image} en la presentación original.`);
    const xfrm = nodes(pic,'a:xfrm')[0], off=nodes(xfrm,'a:off')[0], ext=nodes(xfrm,'a:ext')[0], rect=nodes(pic,'a:srcRect')[0];
    const transform={x:Number(off.getAttribute('x')),y:Number(off.getAttribute('y')),cx:Number(ext.getAttribute('cx')),cy:Number(ext.getAttribute('cy'))};
    const image = m.slides.find(slide=>slide.number===block.slide).images.find(image=>image.name===block.image);
    const crop=Object.fromEntries(['l','r','t','b'].map(key=>[key,rect?.getAttribute(key)||0]));
    let id=Math.max(...nodes(doc,'p:cNvPr').map(node=>Number(node.getAttribute('id'))))+1;
    const shapes=block.cells.map(cell=>numericShape(id++,{...cell,sheet:block.sheet},transform,image.width,image.height,crop)).join('');
    zip.file(slidePath,original.replace('</p:spTree>',shapes+'</p:spTree>'),{createFolders:false});
  }
  return blocks;
}
async function exportTemplate(report, extension, { automatic: useAutomatic = true } = {}) {
  const source = await template(extension), edits = report.templateEdits || { cells: {}, texts: {}, images: {} };
  const automatic = useAutomatic && report.data?.records ? await buildAutomatic(report,edits) : null;
  // Untouched templates remain byte-identical to the user's files.
  if (!automatic && extension === 'xlsx' && !Object.keys(edits.cells || {}).length) return source;
  if (!automatic && extension === 'pptx' && !Object.keys(edits.texts || {}).length && !Object.keys(edits.images || {}).length) return source;
  const zip = await JSZip.loadAsync(source), m = await manifest();
  if (extension === 'xlsx') {
    for (const sheet of m.sheets) {
      if (automatic) {
        const changes=automatic.entries.filter(entry=>entry.sheet===sheet.name);
        if (!changes.length) continue;
        let content=await zip.file(sheet.zipPath).async('string');
        for (const change of changes) content=applyCell(content,change,automatic);
        zip.file(sheet.zipPath,content,{createFolders:false});
        continue;
      }
      const changes = Object.entries(edits.cells || {}).filter(([key]) => key.startsWith(sheet.id + ':'));
      if (!changes.length) continue;
      let content = await zip.file(sheet.zipPath).async('string');
      for (const [key, value] of changes) {
        const coordinate = key.split(':')[1];
        const regex = new RegExp(`<c\\b[^>]*\\br="${coordinate}"[^>]*>[\\s\\S]*?<\\/c>`);
        content = content.replace(regex, cell => cell.replace(/<v>[^<]*<\/v>/, `<v>${value}</v>`));
      }
      zip.file(sheet.zipPath, content, { createFolders: false });
    }
    let workbook = await zip.file('xl/workbook.xml').async('string');
    workbook = workbook.replace(/<calcPr\b[^>]*\/?\s*>/, '<calcPr calcId="0" fullCalcOnLoad="1" forceFullCalc="1"/>');
    zip.file('xl/workbook.xml', workbook, { createFolders: false });
  } else {
    const automaticTexts={};
    if (automatic) {
      const blocks=await fillSlides(zip,automatic,edits,m);
      await embedLato(zip);
      const months=['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SET','OCT','NOV','DIC'];
      const short=months[Number(automatic.period.slice(5))-1]+'-'+automatic.period.slice(2,4);
      for (const slide of m.slides) {
        const linked=[1,28,...blocks.map(block=>block.slide)].includes(slide.number);
        for (const text of slide.texts) {
          if (/^(?:ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SET|SEP|OCT|NOV|DIC)-\d{2}$/i.test(text.value.trim())) automaticTexts[`${slide.number}:${text.index}`]=linked ? short : 'PEND.';
          else if (slide.number===1 && /(?:SETIEMBRE|SEPTIEMBRE) 2026/.test(text.value)) automaticTexts[`${slide.number}:${text.index}`]=report.data.demo?'DATOS FICTICIOS':dateLabel(automatic.period).toUpperCase();
        }
      }
    }
    const textEdits={...automaticTexts,...edits.texts};
    for (const slide of m.slides) {
      if (!Object.keys(textEdits).some(key => key.startsWith(slide.number + ':'))) continue;
      let index = 0;
      const content = (await zip.file(`ppt/slides/slide${slide.number}.xml`).async('string')).replace(/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>/g, text => {
        const key = `${slide.number}:${index++}`;
        return Object.hasOwn(textEdits, key) ? text.replace(/(>)[\s\S]*(<\/a:t>)/, (_match, opening, closing) => opening + escape(textEdits[key]) + closing) : text;
      });
      zip.file(`ppt/slides/slide${slide.number}.xml`, content, { createFolders: false });
    }
    for (const [name, value] of Object.entries(edits.images || {})) zip.file(`ppt/media/${name}`, Buffer.from(value, 'base64'), { createFolders: false });
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
async function originalImage(name) {
  const m = await manifest();
  if (!m.slides.some(s => s.images.some(i => i.name === name))) throw error('Imagen no encontrada.');
  const zip = await JSZip.loadAsync(await template('pptx'));
  return zip.file('ppt/media/' + name).async('nodebuffer');
}
async function suggestions(report) {
  const m = await manifest(), changes = [];
  const sourceSheet = m.sheets.find(s => s.name === 'Base de Datos Ventas');
  const categories = [
    { label: 'Granel', column: 'Q', matches: r => r.cc ? r.cc === 'GRANEL' : r.grupo.toLowerCase() === 'granel' },
    { label: 'Pulperías (CC PULPERIAS)', column: 'I', matches: r => r.cc === 'PULPERIAS' },
    { label: 'Distribuidores (CC DISTRIBUIDOR y DISTRIBUIDOR PLANTA)', column: 'E', matches: r => ['DISTRIBUIDOR', 'DISTRIBUIDOR PLANTA'].includes(r.cc) }
  ];
  for (const category of categories) {
  const rows = report.data.records.filter(category.matches);
  if (!rows.length) continue;
  for (const [month, number] of [['2026-08', '17'], ['2026-09', '18']]) {
    const coordinate = category.column + number;
    if (!report.data.months.includes(month)) continue;
    const total = Math.round(rows.reduce((sum, row) => sum + Math.round(row.values[month] * 100), 0)) / 100;
    const cell = sourceSheet?.cells.find(c => c.coordinate === coordinate);
    if (cell) changes.push({ key: `${sourceSheet.id}:${coordinate}`, label: `${category.label} ${month} · ${sourceSheet.name}!${coordinate}`, original: cell.value, value: total });
  }
  }
  return changes;
}
module.exports = { manifest, validateEdits, exportTemplate, originalImage, suggestions, template };
