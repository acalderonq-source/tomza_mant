const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const enviarCorreo = require('../utils/mail');
const { correoValido,normalizarCorreo } = require('../utils/pagoProveedorCorreo');
const { fechaActualCostaRica } = require('../utils/fechaCostaRica');
const finanzas = require('../utils/carburacionFinanzas');
const {filtrosFactura,retornoFacturas}=require('../utils/carburacionFiltrosFacturas');
const router = express.Router();
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);
router.param('id',(req,res,next,id) => {
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return res.sendStatus(404);
  next();
});
router.use((req,res,next) => {
  res.locals.money = (value,moneda='CRC') => Number(value || 0).toLocaleString('es-CR',{style:'currency',currency:moneda});
  res.locals.fecha = value => value ? finanzas.fechaISO(value) : '';
  res.locals.hoy = fechaActualCostaRica();
  res.locals.volverUrl = retornoFacturas(req.query.return_to || req.body?.return_to);
  res.locals.success = req.session.success || null;
  delete req.session.success;
  next();
});
router.get('/ordenes/:id/factura', wrap(async (req,res) => {
  const [[orden]] = await pool.query(`SELECT o.*,p.nombre proveedor FROM carburacion_ordenes o
    JOIN carburacion_proveedores p ON p.id=o.proveedor_id WHERE o.id=? AND o.eliminado_en IS NULL`,[req.params.id]);
  if (!orden) throw finanzas.fallo('Orden de Carburación no encontrada.',404);
  const [[factura]] = await pool.query('SELECT id,numero FROM carburacion_facturas WHERE orden_id=?',[orden.id]);
  if (factura) return res.redirect(`/carburacion/facturas?buscar=${encodeURIComponent(factura.numero)}`);
  const hoy = fechaActualCostaRica();
  const date = new Date(`${hoy}T12:00:00Z`); date.setUTCDate(date.getUTCDate()+30);
  res.render('carburacion/factura_form',{orden,proveedores:[],clientes:[],vencimiento:date.toISOString().slice(0,10)});
}));
router.post('/ordenes/:id/factura',wrap(async (req,res) => {
  await finanzas.registrarFactura(req.params.id,req.body,req.session.user);
  req.session.success='Factura registrada en Carburación.';
  res.redirect(res.locals.volverUrl);
}));
router.get('/facturas/nueva',wrap(async (_req,res) => {
  const [proveedores]=await pool.query('SELECT id,nombre FROM carburacion_proveedores ORDER BY nombre');
  const [clientes]=await pool.query('SELECT id,nombre FROM carburacion_clientes ORDER BY nombre');
  const date=new Date(`${fechaActualCostaRica()}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+30);
  res.render('carburacion/factura_form',{orden:null,proveedores,clientes,vencimiento:date.toISOString().slice(0,10)});
}));
router.post('/facturas/agregar',wrap(async(req,res)=>{
  await finanzas.registrarFactura(null,req.body,req.session.user);
  req.session.success='Factura sin orden registrada en Carburación.';
  res.redirect(res.locals.volverUrl);
}));
router.get('/facturas',wrap(async (req,res) => {
  const f=filtrosFactura(req.query);
  const [resumen]=await pool.query(`SELECT f.moneda,COUNT(*) cantidad,SUM(f.total) total,SUM(f.pagado) pagado,SUM(f.total-f.pagado) saldo ${finanzas.FACTURAS_FROM}${f.where} GROUP BY f.moneda`,f.params);
  const total=resumen.reduce((sum,r)=>sum+Number(r.cantidad || 0),0);
  const totalPaginas=Math.max(1,Math.ceil(total/f.filtros.por_pagina));
  const pagina=Math.min(f.pagina,totalPaginas),offset=(pagina-1)*f.filtros.por_pagina;
  const [facturas]=await pool.query(`${finanzas.FACTURAS_SELECT}${f.where} ORDER BY f.fecha ${f.filtros.orden.toUpperCase()},f.id ${f.filtros.orden.toUpperCase()} LIMIT ? OFFSET ?`,[...f.params,f.filtros.por_pagina,offset]);
  const [proveedores]=await pool.query('SELECT id,nombre FROM carburacion_proveedores ORDER BY nombre');
  const paginacion={pagina,porPagina:f.filtros.por_pagina,total,totalPaginas,desde:total?offset+1:0,hasta:Math.min(offset+facturas.length,total)};
  res.render('carburacion/facturas',{facturas,proveedores,resumen,filtros:f.filtros,paginacion});
}));
router.get('/facturas/pago',wrap(async (req,res) => {
  const ids=finanzas.idsFacturas(req.query.facturas_ids);
  const facturas=await finanzas.seleccionFacturas(ids);
  res.render('carburacion/pago_form',{facturas,token:crypto.randomUUID(),saldo:facturas.reduce((sum,f)=>sum+finanzas.centavos(f.total)-finanzas.centavos(f.pagado),0)/100});
}));
router.post('/facturas/pagar',wrap(async (req,res) => {
  const resultado=await finanzas.registrarPago(req.body,req.session.user);
  req.session.success=resultado.repetido ? 'Este pago ya estaba registrado. No se duplicó.' : 'Pago registrado y colilla generada.';
  // El pago permanece confirmado aunque el proveedor o SMTP no estén configurados.
  if (req.body.enviar_correo === '1' && !resultado.repetido) {
    try {
      const estado=await finanzas.enviarPago(resultado.id,req.session.user);
      req.session.success += estado === 'ENVIADO' ? ' Correo enviado.' : ' Revise el estado del correo en el historial.';
    } catch { req.session.success += ' El correo requiere revisión desde el historial.'; }
  }
  res.redirect('/carburacion/facturas/historial-pagos?return_to='+encodeURIComponent(res.locals.volverUrl));
}));
router.get('/facturas/historial-pagos',wrap(async (req,res) => {
  const condiciones=[],params=[];
  const desde=finanzas.fechaValida(req.query.desde) ? req.query.desde : '';
  const hasta=finanzas.fechaValida(req.query.hasta) ? req.query.hasta : '';
  if (desde) {condiciones.push('p.fecha>=?');params.push(desde);}
  if (hasta) {condiciones.push('p.fecha<=?');params.push(hasta);}
  const [pagos]=await pool.query(`SELECT p.id,p.recibo_numero,p.fecha,p.moneda,p.total,p.tipo,p.comprobante_numero,
    p.comprobante_nombre,p.facturas_json,p.generado_por,pr.nombre proveedor,e.estado correo_estado,e.error correo_error,
    e.correo_destino,e.intentos,e.enviado_en,e.iniciado_en
    FROM carburacion_pagos p JOIN carburacion_proveedores pr ON pr.id=p.proveedor_id
    LEFT JOIN carburacion_pago_envios e ON e.pago_id=p.id
    ${condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''} ORDER BY p.fecha DESC,p.id DESC LIMIT 250`,params);
  res.render('carburacion/historial_pagos',{pagos:pagos.map(p=>({...p,facturas:finanzas.detallePago(p)})),filtros:{desde,hasta}});
}));
router.get('/facturas/configuracion-correo',wrap(async (_req,res) => {
  const [[config]]=await pool.query('SELECT copia_1,copia_2,copia_3,correo_respuesta FROM carburacion_correo_config WHERE id=1');
  const perfil = enviarCorreo.estaConfigurado('carburacion') ? 'carburacion' : 'facturas';
  res.render('carburacion/correos_pago',{config:config || {},remitente:enviarCorreo.obtenerRemitente(perfil),smtpConfigurado:enviarCorreo.estaConfigurado(perfil)});
}));
router.post('/facturas/configuracion-correo',wrap(async (req,res) => {
  const copias=[req.body.copia_1,req.body.copia_2,req.body.copia_3].map(normalizarCorreo);
  const respuesta=normalizarCorreo(req.body.correo_respuesta);
  const usadas=copias.filter(Boolean);
  if (!usadas.length || usadas.some(c=>!correoValido(c) || c.length>200) || new Set(usadas).size!==usadas.length || (respuesta && (!correoValido(respuesta) || respuesta.length>200))) throw finanzas.fallo('Ingrese al menos una copia válida, sin repetir direcciones, y un correo de respuesta válido.');
  await pool.query(`UPDATE carburacion_correo_config SET copia_1=?,copia_2=?,copia_3=?,correo_respuesta=?,
    actualizado_por=?,actualizado_en=CURRENT_TIMESTAMP WHERE id=1`,[...copias,respuesta || null,req.session.user.id]);
  req.session.success='Correos de Carburación guardados.';
  res.redirect('/carburacion/facturas/configuracion-correo?return_to='+encodeURIComponent(res.locals.volverUrl));
}));
router.post('/facturas/colillas/:id/enviar',wrap(async (req,res) => {
  const estado=await finanzas.enviarPago(req.params.id,req.session.user);
  const mensajes={ENVIADO:'Correo enviado con la colilla y el comprobante.',SIN_CORREO:'Actualice el correo del proveedor para enviar la colilla.',PENDIENTE_CONFIG:'Configure el remitente y al menos una copia interna.',ERROR:'No se pudo enviar el correo. Puede reintentar desde el historial.',YA_PROCESADO:'Este correo ya fue enviado o está en proceso. No se duplicó.'};
  req.session.success=mensajes[estado];
  res.redirect('/carburacion/facturas/historial-pagos?return_to='+encodeURIComponent(res.locals.volverUrl));
}));
router.get('/facturas/colillas/:id/descargar',wrap(async (req,res) => {
  const [[pago]]=await pool.query(`SELECT id,recibo_numero,fecha,moneda,total,comprobante_numero,generado_por,facturas_json
    FROM carburacion_pagos WHERE id=?`,[req.params.id]);
  if (!pago) throw finanzas.fallo('Colilla de Carburación no encontrada.',404);
  res.set('Cache-Control','no-store').type('pdf').set('Content-Disposition',`attachment; filename="${pago.recibo_numero}.pdf"`).send(await finanzas.pdfPago(pago));
}));
router.get('/facturas/:id/archivo',wrap(async (req,res) => {
  const [[factura]]=await pool.query('SELECT archivo,archivo_tipo,archivo_nombre FROM carburacion_facturas WHERE id=?',[req.params.id]);
  if (!factura?.archivo) throw finanzas.fallo('Factura adjunta no encontrada.',404);
  res.set('Cache-Control','no-store').set('X-Content-Type-Options','nosniff').type(factura.archivo_tipo).attachment(factura.archivo_nombre).send(factura.archivo);
}));
router.get('/facturas/colillas/:id/comprobante',wrap(async (req,res) => {
  const [[pago]]=await pool.query('SELECT comprobante,comprobante_tipo,comprobante_nombre FROM carburacion_pagos WHERE id=?',[req.params.id]);
  if (!pago?.comprobante) throw finanzas.fallo('Comprobante no encontrado.',404);
  res.set('Cache-Control','no-store').set('X-Content-Type-Options','nosniff').type(pago.comprobante_tipo).attachment(pago.comprobante_nombre).send(pago.comprobante);
}));
router.use((error,req,res,next) => {
  if (!error.status) return next(error);
  res.status(error.status).render('carburacion/finanzas_error',{mensaje:error.message});
});
module.exports=router;
