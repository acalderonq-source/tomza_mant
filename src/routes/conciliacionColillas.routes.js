const router=require('express').Router();
const pool=require('../db');
const {fechaActualCostaRica}=require('../utils/fechaCostaRica');
const {conciliar,cotejarDocumentos}=require('../utils/conciliacionColillas');
router.get('/',async(req,res)=>{
 if(!req.session?.user)return res.redirect('/login');
 if(!['ADMIN','TALLER','PROVEEDURIA_TALLER','CONTABILIDAD'].includes(req.session.user.rol))return res.status(403).send('No autorizado');
 res.set('Cache-Control','no-store');
 try {
  const periodo=String(req.query.periodo||fechaActualCostaRica().slice(0,7));
  const origen=String(req.query.origen||'actual');
  if(!['actual','reconstruido'].includes(origen))return res.status(400).send('Origen inválido. Consulte cada fuente por separado.');
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)||Number(periodo.slice(0,4))<2000)return res.status(400).send('Periodo inválido');
  const [anio,mes]=periodo.split('-').map(Number);
  const hasta=new Date(Date.UTC(anio,mes,1)).toISOString().slice(0,10);
  const [colillas]=await pool.query("SELECT id,recibo_numero,DATE_FORMAT(fecha_pago,'%Y-%m-%d') fecha_pago,tipo_pago,total_pagado,facturas_json FROM colillas_pago_proveedor WHERE origen=? AND fecha_pago>=? AND fecha_pago<? ORDER BY fecha_pago DESC,id DESC LIMIT 2001",[origen,periodo+'-01',hasta]);
  if(colillas.length>2000)return res.status(422).send('El mes supera el límite de 2000 colillas. Requiere un reporte por lotes.');
  const ids=new Set(),independientes=new Set();
  for(const c of colillas){try{const rows=typeof c.facturas_json==='string'?JSON.parse(c.facturas_json):c.facturas_json;if(Array.isArray(rows))rows.forEach(f=>{if(Number.isSafeInteger(Number(f.factura_id))&&Number(f.factura_id)>0){if(f.tipo==='orden')ids.add(Number(f.factura_id));if(f.tipo==='independiente')independientes.add(Number(f.factura_id));}});}catch(_) {}}
  if(ids.size+independientes.size>20000)return res.status(422).send('Demasiadas referencias para una consulta interactiva. No se truncaron los totales.');
  const monedas=new Map();
  const documentos=new Map();
  if(ids.size){const [ordenes]=await pool.query('SELECT id,moneda,total,pagada,abono_monto,nota_credito_monto FROM ordenes_compra WHERE id IN (?)',[[...ids]]);ordenes.forEach(o=>{monedas.set(o.id,String(o.moneda||'').trim().toUpperCase());documentos.set('orden:'+o.id,o);});}
  if(independientes.size){const [facturas]=await pool.query('SELECT id,monto AS total,pagada,abono_monto,nota_credito_monto FROM facturas WHERE id IN (?)',[[...independientes]]);facturas.forEach(f=>documentos.set('independiente:'+f.id,f));}
  const informe=conciliar(colillas,monedas);
  const revisiones=cotejarDocumentos(informe.movimientos,documentos);
  res.render('compras/conciliacion_colillas',{user:req.session.user,periodo,origen,revisiones,colillas:colillas.length,informe});
 }catch(error){console.error('Conciliación de colillas:',error.code||error.message);res.status(503).send('No se pudo consultar la conciliación. No se modificó ningún pago.');}
});
module.exports=router;
