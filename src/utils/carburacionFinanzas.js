const crypto = require('crypto');
const pool = require('../db');
const enviarCorreo = require('./mail');
const { generarPDFReciboPago } = require('./pdfReciboPago');
const { construirCorreoPago, correoValido, normalizarCorreo } = require('./pagoProveedorCorreo');
const { fechaActualCostaRica } = require('./fechaCostaRica');

function fallo(mensaje, status = 400) { const error = new Error(mensaje); error.status = status; return error; }
function fechaValida(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === value;
}
function centavos(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw fallo('Indique un monto positivo con un máximo de dos decimales.');
  const [entero, decimal = ''] = raw.split('.');
  const n = Number(entero) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(n) || n >= 1e16) throw fallo('El monto es demasiado grande.');
  return n;
}
function idsFacturas(value) {
  const lista = Array.isArray(value) ? value : value ? [value] : [];
  if (!lista.length || lista.length > 100 || lista.some(id => !/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id)))) throw fallo('Seleccione entre una y cien facturas válidas.');
  const ids = lista.map(Number);
  if (new Set(ids).size !== ids.length) throw fallo('Una factura no puede aparecer dos veces en el pago.');
  return ids.sort((a,b) => a-b);
}
function adjunto(data, nombre) {
  if (!data) return null;
  const match = /^data:(application\/pdf|image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(data));
  if (!match) throw fallo('El archivo debe ser PDF, PNG o JPG.');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) throw fallo('El archivo debe pesar como máximo 5 MB.');
  const tipo = match[1];
  const valido = tipo === 'application/pdf' ? buffer.subarray(0,5).toString() === '%PDF-'
    : tipo === 'image/png' ? buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (!valido) throw fallo('El contenido del archivo no coincide con su tipo.');
  const extension = tipo === 'application/pdf' ? '.pdf' : tipo === 'image/png' ? '.png' : '.jpg';
  const base = String(nombre || 'documento').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0,170).replace(/\.[^.]+$/, '');
  return { buffer, tipo, nombre: `${base || 'documento'}${extension}` };
}
async function registrarFactura(ordenId, body, user) {
  const numero = String(body.numero || '').trim();
  if (!numero || numero.length > 100 || !fechaValida(body.fecha) || !fechaValida(body.vencimiento) || body.vencimiento < body.fecha) throw fallo('Revise el número de factura, fecha y vencimiento.');
  const archivo = adjunto(body.archivo_data, body.archivo_nombre);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let orden=null,proveedorId,moneda,cliente='',clienteId=null;
    if(ordenId!=null) {
      [[orden]] = await connection.query('SELECT id,proveedor_id,moneda,total,placa_unidad,cliente_id FROM carburacion_ordenes WHERE id=? AND eliminado_en IS NULL FOR UPDATE', [ordenId]);
      if (!orden) throw fallo('Orden de Carburación no encontrada.',404);
      const [[existente]] = await connection.query('SELECT id FROM carburacion_facturas WHERE orden_id=?', [orden.id]);
      if (existente) throw fallo('Esta orden ya tiene una factura registrada.',409);
      proveedorId=orden.proveedor_id;moneda=orden.moneda;cliente=orden.placa_unidad;clienteId=orden.cliente_id || null;
    } else {
      const [[proveedor]]=await connection.query('SELECT id FROM carburacion_proveedores WHERE id=?',[body.proveedor_id]);
      if(!proveedor)throw fallo('Seleccione un proveedor de Carburación.');
      if(!['CRC','USD'].includes(body.moneda))throw fallo('Seleccione colones o dólares.');
      proveedorId=proveedor.id;moneda=body.moneda;
      if(body.cliente_id) {
        const [[registro]]=await connection.query('SELECT id,nombre FROM carburacion_clientes WHERE id=?',[body.cliente_id]);
        if(!registro)throw fallo('Seleccione un cliente de Carburación.');
        cliente=registro.nombre;clienteId=registro.id;
      }
    }
    const monto = body.total ? centavos(body.total) : orden ? centavos(orden.total) : 0;
    if (monto <= 0) throw fallo('El total de la factura debe ser mayor que cero.');
    await connection.query(`INSERT INTO carburacion_facturas
      (orden_id,proveedor_id,numero,fecha,vencimiento,moneda,total,cliente,observacion,archivo_nombre,archivo_tipo,archivo,creado_por,cliente_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [orden?.id || null,proveedorId,numero,body.fecha,body.vencimiento,moneda,monto/100,cliente,String(body.observacion || '').slice(0,5000),archivo?.nombre || null,archivo?.tipo || null,archivo?.buffer || null,user.id,clienteId]);
    if(orden)await connection.query("UPDATE carburacion_ordenes SET estado='FACTURADA',actualizado_por=?,actualizado_en=CURRENT_TIMESTAMP WHERE id=?",[user.id,orden.id]);
    await connection.commit();
  } catch(error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') throw fallo('Ya existe esa factura para este proveedor o esa orden.',409);
    throw error;
  } finally { connection.release(); }
}
const FACTURAS_FROM = `FROM carburacion_facturas f LEFT JOIN carburacion_ordenes o ON o.id=f.orden_id
  JOIN carburacion_proveedores p ON p.id=f.proveedor_id`;
const FACTURAS_SELECT = `SELECT f.id,f.orden_id,f.proveedor_id,f.numero,f.fecha,f.vencimiento,f.moneda,
  f.total,f.pagado,f.cliente,f.cliente_id,f.periodo_cierre,f.observacion,f.archivo_nombre,o.po_numero,p.nombre proveedor_nombre,p.email proveedor_email
  ${FACTURAS_FROM}`;
async function seleccionFacturas(ids, connection = pool, bloquear = false) {
  const [facturas] = await connection.query(`${FACTURAS_SELECT} WHERE f.id IN (${ids.map(() => '?').join(',')}) ORDER BY f.id${bloquear ? ' FOR UPDATE' : ''}`,ids);
  if (facturas.length !== ids.length) throw fallo('Una de las facturas no pertenece a Carburación o no existe.',404);
  if (new Set(facturas.map(f => `${f.proveedor_id}:${f.moneda}`)).size !== 1) throw fallo('Cada pago debe contener facturas del mismo proveedor y de la misma moneda.');
  if (facturas.some(f => centavos(f.total) <= centavos(f.pagado))) throw fallo('Una de las facturas ya está pagada. Actualice la selección.',409);
  return facturas;
}
async function registrarPago(body, user) {
  const ids = idsFacturas(body.facturas_ids);
  if (!/^[a-f0-9-]{36}$/i.test(String(body.token || ''))) throw fallo('El formulario de pago venció. Vuelva a abrirlo.');
  if (!fechaValida(body.fecha) || body.fecha > fechaActualCostaRica()) throw fallo('Indique una fecha de pago válida, hasta hoy.');
  if (!['pago','abono'].includes(body.tipo)) throw fallo('Seleccione pago completo o abono.');
  const periodo = String(body.periodo_cierre || body.fecha.slice(0,7));
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo))throw fallo('Indique un periodo de cierre válido.');
  const comprobante = adjunto(body.comprobante_data, body.comprobante_nombre);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Bloqueo por factura: dos pagos concurrentes nunca pueden superar el saldo.
    const facturas = await seleccionFacturasSinSaldo(ids,connection);
    const [[anterior]] = await connection.query('SELECT id FROM carburacion_pagos WHERE token=?',[body.token]);
    if (anterior) { await connection.commit(); return { id: anterior.id, repetido: true }; }
    if (facturas.some(f => centavos(f.total) <= centavos(f.pagado))) throw fallo('Una de las facturas ya está pagada.',409);
    if (facturas.some(f => body.fecha < fechaISO(f.fecha))) throw fallo('La fecha de pago no puede ser anterior a la factura.');
    if (body.tipo === 'abono' && facturas.length !== 1) throw fallo('Seleccione una sola factura para registrar un abono.');
    const saldo = facturas.reduce((sum,f) => sum + centavos(f.total)-centavos(f.pagado),0);
    if (!Number.isSafeInteger(saldo)) throw fallo('El total seleccionado es demasiado grande. Registre los pagos por separado.');
    const monto = body.tipo === 'abono' ? centavos(body.monto) : saldo;
    if (monto <= 0 || monto > saldo) throw fallo('El monto debe ser mayor que cero y no superar el saldo.');
    const detalles = facturas.map(f => ({
      factura_id: f.id, po_numero: f.po_numero, factura: f.numero, proveedor_id: f.proveedor_id,
      proveedor_nombre: f.proveedor_nombre, fecha_vencimiento_factura: fechaISO(f.vencimiento),
      total: (body.tipo === 'abono' ? monto : centavos(f.total)-centavos(f.pagado))/100,
      monto_pago: (body.tipo === 'abono' ? monto : centavos(f.total)-centavos(f.pagado))/100,
      abonos_previos: Number(f.pagado), abono_monto: Number(f.pagado), observacion: String(body.observacion || f.observacion || '').slice(0,5000)
    }));
    const tipo = body.tipo === 'abono' ? 'abono' : facturas.length > 1 ? 'pago_multiple' : 'pago';
    const generadoPor = String(user.nombre || user.usuario || 'Carburación').slice(0,160);
    const [result] = await connection.query(`INSERT INTO carburacion_pagos
      (token,proveedor_id,fecha,moneda,total,tipo,comprobante_numero,comprobante_nombre,comprobante_tipo,comprobante,observacion,facturas_json,creado_por,generado_por,periodo_cierre)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [body.token,facturas[0].proveedor_id,body.fecha,facturas[0].moneda,monto/100,tipo,String(body.comprobante_numero || '').slice(0,120),comprobante?.nombre || null,comprobante?.tipo || null,comprobante?.buffer || null,String(body.observacion || '').slice(0,5000),JSON.stringify(detalles),user.id,generadoPor,periodo]);
    const recibo = `CAR-RP-${String(result.insertId).padStart(6,'0')}`;
    await connection.query('UPDATE carburacion_pagos SET recibo_numero=? WHERE id=?',[recibo,result.insertId]);
    for (const detalle of detalles) {
      await connection.query('INSERT INTO carburacion_pagos_detalle (pago_id,factura_id,monto) VALUES (?,?,?)',[result.insertId,detalle.factura_id,detalle.monto_pago]);
      await connection.query('UPDATE carburacion_facturas SET pagado=pagado+?,periodo_cierre=? WHERE id=?',[detalle.monto_pago,periodo,detalle.factura_id]);
    }
    await connection.query('INSERT INTO carburacion_pago_envios (pago_id) VALUES (?)',[result.insertId]);
    await connection.commit();
    return { id: result.insertId, repetido: false };
  } catch(error) { await connection.rollback(); throw error; } finally { connection.release(); }
}
async function seleccionFacturasSinSaldo(ids,connection) {
  const [facturas] = await connection.query(`${FACTURAS_SELECT} WHERE f.id IN (${ids.map(() => '?').join(',')}) ORDER BY f.id FOR UPDATE`,ids);
  if (facturas.length !== ids.length) throw fallo('Factura de Carburación no encontrada.',404);
  if (new Set(facturas.map(f => `${f.proveedor_id}:${f.moneda}`)).size !== 1) throw fallo('Seleccione facturas del mismo proveedor y de la misma moneda.');
  return facturas;
}
function fechaISO(value) { return typeof value === 'string' ? value.slice(0,10) : new Intl.DateTimeFormat('en-CA',{ timeZone:'America/Costa_Rica',year:'numeric',month:'2-digit',day:'2-digit' }).format(value); }
function detallePago(pago) { return typeof pago.facturas_json === 'string' ? JSON.parse(pago.facturas_json) : pago.facturas_json; }
async function pdfPago(pago) {
  return generarPDFReciboPago({ facturas: detallePago(pago), fechaPago: fechaISO(pago.fecha), totalPagado: pago.total,
    reciboNumero: pago.recibo_numero, comprobanteNumero: pago.comprobante_numero, generadoPor: pago.generado_por,
    moneda: pago.moneda, departamento: 'Carburación' });
}
async function enviarPago(id,user) {
  const [[pago]] = await pool.query('SELECT * FROM carburacion_pagos WHERE id=?',[id]);
  if (!pago) throw fallo('Colilla de Carburación no encontrada.',404);
  const [[proveedor]] = await pool.query('SELECT email FROM carburacion_proveedores WHERE id=?',[pago.proveedor_id]);
  const [[config]] = await pool.query('SELECT copia_1,copia_2,copia_3,correo_respuesta FROM carburacion_correo_config WHERE id=1');
  const correo = normalizarCorreo(proveedor?.email);
  const copias = [config?.copia_1,config?.copia_2,config?.copia_3].map(normalizarCorreo).filter(Boolean);
  const replyTo = normalizarCorreo(config?.correo_respuesta);
  const perfil = enviarCorreo.estaConfigurado('carburacion') ? 'carburacion' : 'facturas';
  const pendiente = !correoValido(correo) ? 'SIN_CORREO' : !enviarCorreo.estaConfigurado(perfil) || !copias.length || copias.some(c => !correoValido(c)) || new Set(copias).size !== copias.length || (replyTo && !correoValido(replyTo)) ? 'PENDIENTE_CONFIG' : '';
  if (pendiente) {
    await pool.query("UPDATE carburacion_pago_envios SET estado=?,error=NULL WHERE pago_id=? AND estado NOT IN ('ENVIADO','ENVIANDO')",[pendiente,pago.id]);
    return pendiente;
  }
  const bloqueo = crypto.randomUUID();
  const [claim] = await pool.query(`UPDATE carburacion_pago_envios SET estado='ENVIANDO',bloqueo_token=?,iniciado_en=CURRENT_TIMESTAMP,
    correo_destino=?,copias_json=?,correo_respuesta=?,solicitado_por=?,intentos=intentos+1,error=NULL
    WHERE pago_id=? AND estado IN ('PENDIENTE','ERROR','SIN_CORREO','PENDIENTE_CONFIG')`,[bloqueo,correo,JSON.stringify(copias),replyTo || null,user.id,pago.id]);
  if (!claim.affectedRows) return 'YA_PROCESADO';
  try {
    const facturas = detallePago(pago);
    const mensaje = construirCorreoPago({ proveedor: facturas[0].proveedor_nombre, facturas,
      reciboNumero: pago.recibo_numero, fechaPago: fechaISO(pago.fecha),totalPagado:pago.total,tipoPago:pago.tipo,
      comprobanteNumero:pago.comprobante_numero,moneda:pago.moneda });
    const attachments = [{ filename: `${pago.recibo_numero}.pdf`, content: await pdfPago(pago), contentType:'application/pdf' }];
    if (pago.comprobante) attachments.push({ filename:pago.comprobante_nombre,content:pago.comprobante,contentType:pago.comprobante_tipo });
    await enviarCorreo(correo, `${mensaje.subject} | Carburación`, mensaje.html, {
      perfil, nombreRemitente: 'Carburación Gas Tomza', cc:copias, ...(replyTo ? {replyTo} : {}),attachments
    });
  } catch(error) {
    await pool.query("UPDATE carburacion_pago_envios SET estado='ERROR',error=? WHERE pago_id=? AND bloqueo_token=?",[String(error.message || 'Error de correo').slice(0,500),pago.id,bloqueo]);
    return 'ERROR';
  }
  // Si falla esta escritura, conservar ENVIANDO: reintentar sin verificar podría duplicar un correo aceptado por SMTP.
  await pool.query("UPDATE carburacion_pago_envios SET estado='ENVIADO',enviado_en=CURRENT_TIMESTAMP,error=NULL WHERE pago_id=? AND bloqueo_token=?",[pago.id,bloqueo]);
  return 'ENVIADO';
}
module.exports = { fallo,fechaValida,fechaISO,centavos,idsFacturas,adjunto,registrarFactura,registrarPago,seleccionFacturas,
  FACTURAS_SELECT,FACTURAS_FROM,pdfPago,enviarPago,detallePago };
