const fs = require('node:fs/promises');
const path = require('node:path');
const { UPLOAD_ROOT } = require('./uploadStorage');
const lista=require('../data/proveedoresPasivosPdf');
const {normalizarEmpresa}=require('./empresasContabilidad');
const clave=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const identidades=require('../data/proveedoresPasivosIdentidades');
const identidad=v=>String(v||'').replace(/\D/g,'').replace(/^0+/,'');
const razon=v=>clave(v).replace(/SOCIEDADDERESPONSABILIDADLIMITADA$/,'SRL').replace(/SOCIEDADANONIMA$/,'SA').replace(/(?:SA|SRL|LTDA)$/,'');
function empresaReceptora(nombre,cedula){
  return {'3101349880':'GAS TOMZA','3101044021':'SUPER GAS'}[identidad(cedula)]||normalizarEmpresa(nombre);
}
function clasificar(proveedor,empresa,cedulaEmisor='',cedulaReceptor=''){
  const fiscal=identidades.find(r=>cedulaEmisor&&r[0]===identidad(cedulaEmisor));
  const variante=identidades.find(r=>r.slice(1).some(a=>razon(a)===razon(proveedor)));
  const nombres=new Set([proveedor,fiscal?.[1],variante?.[1]].filter(Boolean).map(razon));
  const candidatos=lista.filter(p=>p.alias.some(a=>nombres.has(razon(a))));
  const e=empresa==='Sin identificar'?'':empresaReceptora(empresa,cedulaReceptor);
  if(e)return candidatos.find(p=>p.empresa===e)||null;
  // Un proveedor compartido requiere empresa confirmada. El sufijo (SG) sí identifica Super Gas.
  return candidatos.length===1?candidatos[0]:null;
}
function fechas(q) {
  const f = { desde: String(q.desde || ''), hasta: String(q.hasta || '') };
  for (const v of Object.values(f)) if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0,10) !== v) throw Object.assign(new Error('Indicá dos fechas válidas.'), { status: 400 });
  if (f.desde > f.hasta) throw Object.assign(new Error('La fecha desde debe ser anterior o igual a hasta.'), { status: 400 });
  return f;
}
function nombre(v) { return String(v || 'Sin dato').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0,110) || 'Sin dato'; }
async function cargar(db, f) {
  const [rows] = await db.query(`SELECT a.id,a.factura_tipo,a.factura_id,a.numero_factura,a.proveedor_nombre,a.fecha_factura,
    CASE WHEN a.factura_tipo='orden' THEN o.factura_foto_producto WHEN a.factura_tipo='independiente' THEN i.factura_foto_producto END ruta,
    p.datos portal_datos,o.empresa_destino empresa_origen
    FROM asientos_pasivos_facturas a
    LEFT JOIN ordenes_compra o ON a.factura_tipo='orden' AND o.id=a.factura_id
    LEFT JOIN facturas i ON a.factura_tipo='independiente' AND i.id=a.factura_id
    LEFT JOIN prov_documentos p ON a.factura_tipo='portal' AND p.id=a.factura_id AND p.tipo='factura_portal'
    WHERE a.fecha_factura>=? AND a.fecha_factura<DATE_ADD(?, INTERVAL 1 DAY)
    ORDER BY a.fecha_factura,a.id`, [f.desde,f.hasta]);
  return rows.map(r => {
    const datos = typeof r.portal_datos === 'string' ? JSON.parse(r.portal_datos) : r.portal_datos;
    const adjunto = datos?.factura?.archivo;
    const empresa=r.factura_tipo==='portal'?require('./portalEmpresaReceptora').empresaFactura(datos||{}):r.empresa_origen;
    const proveedor=clasificar(r.proveedor_nombre,empresa);
    return { ...r, empresa:proveedor?.empresa,grupo:proveedor?.grupo,enLista:!!proveedor, portal_datos: undefined, adjunto, disponible: r.factura_tipo === 'portal' ? !!adjunto?.id && adjunto.mime === 'application/pdf' : /^\/uploads\/facturas\/[^/\\]+\.pdf$/i.test(r.ruta || '') };
  }).filter(r=>r.enLista&&(!f.empresa||r.empresa===f.empresa)&&(!f.grupo||r.grupo===f.grupo));
}
async function contenido(db,r) {
  let b;
  if(r.factura_tipo==='portal') { const [rows]=await db.query('SELECT contenido FROM prov_adjuntos WHERE id=?',[r.adjunto.id]); b=rows[0]?.contenido; }
  else {
    if(!/^\/uploads\/facturas\/[^/\\]+\.pdf$/i.test(r.ruta||'')) throw new Error('Ruta de PDF inválida');
    b=await fs.readFile(path.join(UPLOAD_ROOT,'facturas',path.basename(r.ruta)));
  }
  if(!Buffer.isBuffer(b) || !b.subarray(0,1024).includes(Buffer.from('%PDF-'))) throw new Error('El adjunto no contiene un PDF válido');
  return b;
}
module.exports={fechas,nombre,cargar,contenido,clasificar,empresaReceptora,identidad};
