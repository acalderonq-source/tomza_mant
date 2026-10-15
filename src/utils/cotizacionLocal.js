const path = require('node:path');
let lecturaEnCurso = false;
function fallo(message, status = 422) { return Object.assign(new Error(message), { status }); }

function numero(texto) {
  let s = String(texto).replace(/[\s\u00a0₡$]/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return NaN;
  const decimal = s.match(/[.,](\d{1,2})$/);
  if (decimal) s = s.slice(0, -decimal[0].length).replace(/[.,]/g, '') + '.' + decimal[1];
  else s = s.replace(/[.,]/g, '');
  return Number(s);
}

function analizarFilas(filas, proveedores = []) {
  const texto = filas.join('\n');
  const normalizar = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const proveedor = proveedores.filter(p => normalizar(p.nombre).length >= 6 && normalizar(texto).includes(normalizar(p.nombre)));
  const lineas = [];
  const codigoDespuesDescripcion = filas.some(f => /(?:producto|descripci[oó]n).*c[oó]digo.*cantidad/i.test(f));
  for (const fila of filas) {
    if (/^\s*(?:sub\s*total|total|iva|impuesto|descuento|transporte|saldo)\b/i.test(fila)) continue;
    const tokens = fila.trim().split(/\s+/).filter(t => !/^(?:₡|\$|CRC|USD|UND|UNID|UNIDAD|PZA)$/i.test(t));
    if (tokens.length < 4) continue;
    const subtotal = numero(tokens.at(-1));
    const precio = numero(tokens.at(-2));
    if (!Number.isFinite(subtotal) || !Number.isFinite(precio) || precio <= 0) continue;
    const esCodigo = t => /^(?=.*\d)[A-Z0-9._\/-]+$/i.test(t);
    const candidatos = [
      { cantidad: numero(tokens.at(-3)), descripcion: tokens.slice(0, -3) },
      { cantidad: numero(tokens[0]), descripcion: tokens.slice(1, -2) }
    ];
    // Algunos proveedores imprimen codigo, cantidad y descripcion, en ese orden.
    if (esCodigo(tokens[0])) candidatos.push({ cantidad: numero(tokens[1]), descripcion: [tokens[0], ...tokens.slice(2, -2)] });
    const candidato = candidatos.find(c => c.cantidad > 0 && Number.isFinite(c.cantidad) && c.descripcion.length &&
      Math.abs(c.cantidad * precio - subtotal) <= Math.max(0.02, subtotal * 0.0001));
    if (!candidato) continue;
    const { cantidad, descripcion } = candidato;
    let codigo = '';
    if (esCodigo(descripcion[0]) && descripcion.length > 1) codigo = descripcion.shift();
    if (!codigo && codigoDespuesDescripcion && esCodigo(descripcion.at(-1)) && descripcion.length > 1) codigo = descripcion.pop();
    // Codigo explicitamente rotulado dentro de la fila, sin interpretar modelos como codigos.
    const etiqueta = descripcion.join(' ').match(/\b(?:c[oó]digo|cod\.?|sku|referencia)\s*[:#]\s*([A-Z0-9._\/-]+)/i);
    if (etiqueta) {
      codigo = etiqueta[1];
      const limpio = descripcion.join(' ').replace(etiqueta[0], '').trim();
      descripcion.splice(0, descripcion.length, limpio);
    }
    const detalle = descripcion.join(' ').replace(/[₡$]\s*$/, '').trim();
    if (!/[a-záéíóúñ]/i.test(detalle)) continue;
    // Solo aceptar filas cuyo importe confirma cantidad y precio, sin adivinar columnas.
    if (Math.abs(cantidad * precio - subtotal) > Math.max(0.02, subtotal * 0.0001)) continue;
    lineas.push({ codigo: '', codigo_producto: codigo, descripcion: detalle, cantidad, precio_unitario: precio, subtotal });
    if (lineas.length > 500) throw fallo('La cotización supera 500 líneas.');
  }
  if (!lineas.length) throw fallo('No se reconoció una tabla con cantidad, descripción, precio unitario e importe. Complete las líneas manualmente; no se modificó la orden.');
  const iva = texto.match(/(?:IVA|impuesto)\s*[:\s]*(\d{1,2}(?:[.,]\d+)?)\s*%/i);
  const placa = texto.match(/placa\s*[:#-]?\s*([A-Z]{1,3}\s*-?\s*\d{3,6})\b/i);
  return {
    proveedor_nombre: proveedor.length === 1 ? proveedor[0].nombre : '',
    moneda: /\bUSD\b|d[oó]lares|US\$/i.test(texto) ? 'USD' : 'CRC',
    forma_pago: /cr[eé]dito/i.test(texto) ? 'Crédito' : /contado/i.test(texto) ? 'Contado' : '',
    placa_unidad: placa ? placa[1].replace(/[\s-]/g, '').toUpperCase() : '',
    iva: iva ? numero(iva[1]) : /exent[oa]/i.test(texto) ? 0 : null,
    observaciones: 'Lectura local de cotización: revisar proveedor, impuestos, descuentos y todas las líneas antes de guardar.',
    lineas
  };
}

async function leerCotizacionLocal({ archivo_data }, proveedores = []) {
  const match = String(archivo_data || '').match(/^data:application\/pdf;base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw fallo('La lectura sin IA admite PDF con texto. Para fotos o documentos escaneados, ingrese las líneas manualmente.', 400);
  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length > 5 * 1024 * 1024) throw fallo('La cotización supera 5 MB.', 400);
  if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw fallo('El archivo no es un PDF válido.', 400);
  if (lecturaEnCurso) throw fallo('El sistema está leyendo otra cotización. Intente nuevamente en unos segundos.', 429);
  lecturaEnCurso = true;
  let task;
  try {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const standardFontDataUrl = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;
    task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, standardFontDataUrl });
    const pdf = await task.promise;
    if (pdf.numPages > 20) throw fallo('La lectura admite hasta 20 páginas.');
    const filas = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      if (content.items.length > 10000) throw fallo('La página contiene demasiados elementos para una lectura segura. Complete las líneas manualmente.');
      const grupos = [];
      for (const item of content.items) {
        if (!item.str?.trim()) continue;
        const y = item.transform[5];
        let grupo = grupos.find(g => Math.abs(g.y - y) < 2);
        if (!grupo) { grupo = { y, items: [] }; grupos.push(grupo); }
        grupo.items.push(item);
      }
      grupos.sort((a,b) => b.y-a.y).forEach(g => {
        const items = g.items.sort((a,b) => a.transform[4]-b.transform[4]);
        let fila = '', anterior;
        for (const item of items) {
          const espacio = anterior && item.transform[4] - (anterior.transform[4] + anterior.width) > 1;
          fila += (espacio ? ' ' : '') + item.str;
          anterior = item;
        }
        filas.push(fila);
      });
      page.cleanup();
    }
    return analizarFilas(filas, proveedores);
  } finally {
    try { if (task) await task.destroy(); } finally { lecturaEnCurso = false; }
  }
}

module.exports = { leerCotizacionLocal, analizarFilas, numero };
