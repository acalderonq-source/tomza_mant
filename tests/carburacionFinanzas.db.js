// Prueba optativa contra MySQL: crea y elimina exclusivamente tablas aisladas de prueba.
// PowerShell: $env:CARBURACION_DB_TEST='1'; node --test tests/carburacionFinanzas.db.js
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const express=require('express');
const pool=require('../src/db');
test('flujo financiero real de Carburación en tablas aisladas, sin enviar correos reales', {skip:process.env.CARBURACION_DB_TEST!=='1',timeout:120000},async()=>{
  const originalQuery=pool.query,originalConnection=pool.getConnection;
  const mailPath=require.resolve('../src/utils/mail');
  const originalMail=require(mailPath);
  const messages=[];let falloCorreo=false;
  const fakeMail=Object.assign(async(...args)=>{if(falloCorreo)throw Error('SMTP simulado no disponible');messages.push(args);},
    {estaConfigurado:()=>true,obtenerRemitente:()=> 'carburacion@example.test'});
  require.cache[mailPath].exports=fakeMail;
  delete require.cache[require.resolve('../src/utils/carburacionFinanzas')];
  const finanzas=require('../src/utils/carburacionFinanzas');
  const {fechaActualCostaRica}=require('../src/utils/fechaCostaRica');
  const hoy=fechaActualCostaRica();
  const suffix=crypto.randomBytes(5).toString('hex');
  const names=['carburacion_proveedores','carburacion_clientes','carburacion_ordenes','carburacion_facturas','carburacion_pagos','carburacion_pagos_detalle','carburacion_correo_config','carburacion_pago_envios'];
  const mapping=Object.fromEntries(names.map(n=>[n,`it_${suffix}_${n}`]));
  const rewrite=sql=>sql.replace(/\bcarburacion_[a-z_]+\b/g,n=>{if(!mapping[n])throw Error(`Tabla inesperada: ${n}`);return mapping[n];})
    .replace(/\bfk_carburacion_(orden|factura)_cliente\b/g,(_match,kind)=>`fk_it_${suffix}_${kind}_cliente`);
  const query=(sql,args)=>originalQuery.call(pool,rewrite(sql),args);
  let listener;
  try {
    for(const filename of ['202610130001_carburacion_ordenes.sql','202610130002_carburacion_facturas_pagos.sql','202610130003_carburacion_clientes.sql','202610130007_carburacion_ordenes_cotizacion_eliminar.sql','202610130004_carburacion_facturas_independientes.sql']) {
      for(const sql of fs.readFileSync(path.join(__dirname,'../migrations',filename),'utf8').split(';').map(s=>s.trim()).filter(Boolean))await query(sql);
    }
    pool.query=query;
    pool.getConnection=async()=>{
      const c=await originalConnection.call(pool);const original=c.query;
      // mysql2 devuelve la misma instancia al pool: restaurar antes de liberarla.
      const release=c.release.bind(c);
      c.query=(sql,args)=>original.call(c,rewrite(sql),args);
      c.release=()=>{c.query=original;c.release=release;release();};
      return c;
    };
    const user={id:34,nombre:'Emily de prueba',departamentoActivo:'CARBURACION',departamentos:['CARBURACION']};
    await query("INSERT INTO carburacion_proveedores (id,nombre,email,creado_por) VALUES (1,'Proveedor A','proveedor@example.test',34),(2,'Proveedor B','otro@example.test',34)");
    for(const [id,proveedor,moneda,total] of [[1,1,'CRC',100],[2,1,'CRC',50],[3,1,'USD',20],[4,2,'CRC',30],[5,1,'CRC',40],[6,1,'CRC',60]]) {
      await query(`INSERT INTO carburacion_ordenes (id,po_numero,fecha,proveedor_id,moneda,empresa_destino,subtotal,descuento,transporte,iva,total,lineas_json,creado_por,placa_unidad)
        VALUES (?,?,?,?,?,'GAS TOMZA',?,0,0,0,?,'[]',34,'Cliente de prueba')`,[id,`CAR-TEST-${id}`,hoy,proveedor,moneda,total,total]);
      await finanzas.registrarFactura(id,{numero:`F-${id}`,fecha:hoy,vencimiento:hoy},user);
    }
    await assert.rejects(finanzas.registrarFactura(1,{numero:'OTRA',fecha:hoy,vencimiento:hoy},user),/ya tiene/);
    const [[count]]=await query('SELECT COUNT(*) cantidad FROM carburacion_facturas');assert.equal(count.cantidad,6);
    await finanzas.registrarFactura(null,{numero:'SIN-ORDEN',fecha:hoy,vencimiento:hoy,proveedor_id:1,moneda:'CRC',total:'17.00'},user);
    const [[independiente]]=await query("SELECT id,orden_id FROM carburacion_facturas WHERE numero='SIN-ORDEN'");assert.equal(independiente.orden_id,null);
    const pagoIndependiente=await finanzas.registrarPago({fecha:hoy,tipo:'pago',facturas_ids:[String(independiente.id)],token:crypto.randomUUID(),periodo_cierre:'2026-09'},user);
    const [[registrada]]=await query('SELECT pagado,periodo_cierre FROM carburacion_facturas WHERE id=?',[independiente.id]);assert.equal(Number(registrada.pagado),17);assert.equal(registrada.periodo_cierre,'2026-09');
    const [[colillaIndependiente]]=await query('SELECT * FROM carburacion_pagos WHERE id=?',[pagoIndependiente.id]);assert.equal((await finanzas.pdfPago(colillaIndependiente)).subarray(0,5).toString(),'%PDF-');
    const pagoBase={fecha:hoy,tipo:'abono',monto:'25.00',facturas_ids:['1'],token:crypto.randomUUID()};
    await assert.rejects(finanzas.registrarPago({...pagoBase,monto:'100.01'},user),/no superar/);
    const abono=await finanzas.registrarPago(pagoBase,user);
    const repetido=await finanzas.registrarPago(pagoBase,user);assert.equal(repetido.id,abono.id);assert.equal(repetido.repetido,true);
    const concurrentes=await Promise.allSettled([1,2].map(()=>finanzas.registrarPago({...pagoBase,tipo:'pago',token:crypto.randomUUID()},user)));
    assert.equal(concurrentes.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(concurrentes.filter(r=>r.status==='rejected').length,1);
    const [[factura]]=await query('SELECT total,pagado FROM carburacion_facturas WHERE id=1');assert.equal(Number(factura.pagado),100);
    await assert.rejects(finanzas.registrarPago({...pagoBase,tipo:'pago',facturas_ids:['2','3'],token:crypto.randomUUID()},user),/misma moneda/);
    await assert.rejects(finanzas.registrarPago({...pagoBase,tipo:'pago',facturas_ids:['2','4'],token:crypto.randomUUID()},user),/mismo proveedor/);
    const multiple=await finanzas.registrarPago({...pagoBase,tipo:'pago',facturas_ids:['2','5'],token:crypto.randomUUID()},user);
    const [[colilla]]=await query('SELECT * FROM carburacion_pagos WHERE id=?',[multiple.id]);
    assert.equal(Number(colilla.total),90);assert.equal(finanzas.detallePago(colilla).length,2);
    const pdf=await finanzas.pdfPago(colilla);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
    assert.equal(await finanzas.enviarPago(multiple.id,user),'PENDIENTE_CONFIG');assert.equal(messages.length,0);
    await query("UPDATE carburacion_correo_config SET copia_1='uno@example.test',copia_2='dos@example.test',copia_3='tres@example.test',correo_respuesta='emily@example.test' WHERE id=1");
    falloCorreo=true;assert.equal(await finanzas.enviarPago(multiple.id,user),'ERROR');falloCorreo=false;
    const envios=await Promise.all([finanzas.enviarPago(multiple.id,user),finanzas.enviarPago(multiple.id,user)]);
    assert.ok(envios.includes('ENVIADO'));assert.ok(envios.includes('YA_PROCESADO'));assert.equal(messages.length,1);
    assert.equal(messages[0][0],'proveedor@example.test');assert.equal(messages[0][3].cc.length,3);assert.equal(messages[0][3].attachments[0].content.subarray(0,5).toString(),'%PDF-');
    assert.equal(await finanzas.enviarPago(multiple.id,user),'YA_PROCESADO');assert.equal(messages.length,1);
    await query("UPDATE carburacion_correo_config SET copia_1='esegura.p@example.test',copia_2=NULL,copia_3=NULL WHERE id=1");
    const usd=await finanzas.registrarPago({...pagoBase,tipo:'pago',facturas_ids:['3'],token:crypto.randomUUID()},user);
    assert.equal(await finanzas.enviarPago(usd.id,user),'ENVIADO');assert.match(messages[1][2],/USD /);assert.doesNotMatch(messages[1][2],/₡/);
    assert.deepEqual(messages[1][3].cc,['esegura.p@example.test']);
    const [[usdPago]]=await query('SELECT * FROM carburacion_pagos WHERE id=?',[usd.id]);
    assert.equal((await finanzas.pdfPago(usdPago)).subarray(0,5).toString(),'%PDF-');
    // Fallo en el detalle revierte tanto la cabecera del pago como el saldo de factura.
    const getConnection=pool.getConnection;
    pool.getConnection=async()=>{const c=await getConnection();const q=c.query;c.query=(sql,args)=>sql.startsWith('INSERT INTO carburacion_pagos_detalle')?Promise.reject(Error('Fallo simulado de detalle')):q(sql,args);return c;};
    const tokenFallido=crypto.randomUUID();
    await assert.rejects(finanzas.registrarPago({...pagoBase,tipo:'pago',facturas_ids:['6'],token:tokenFallido},user),/Fallo simulado/);
    pool.getConnection=getConnection;
    const [[sinPago]]=await query('SELECT pagado FROM carburacion_facturas WHERE id=6');assert.equal(Number(sinPago.pagado),0);
    const [sinCabecera]=await query('SELECT id FROM carburacion_pagos WHERE token=?',[tokenFallido]);assert.equal(sinCabecera.length,0);
    const routes=require('../src/routes/carburacion.routes');
    const app=express();app.set('views',path.join(__dirname,'../src/views'));app.set('view engine','ejs');app.use(express.urlencoded({extended:true}));
    app.use((req,res,next)=>{req.session={user};next();});app.use('/carburacion',routes);
    listener=app.listen(0,'127.0.0.1');await new Promise(resolve=>listener.once('listening',resolve));
    const base=`http://127.0.0.1:${listener.address().port}`;
    for(const route of ['dashboard','ordenes','facturas','facturas/nueva','facturas/historial-pagos','facturas/configuracion-correo','facturas/pago?facturas_ids=6']) {
      const response=await fetch(`${base}/carburacion/${route}`);assert.equal(response.status,200,route);assert.match(await response.text(),/Carburación/);
    }
    const bloqueada=await fetch(`${base}/carburacion/ordenes/1/editar`);assert.equal(bloqueada.status,409);
    const filtrada=await fetch(`${base}/carburacion/facturas?origen=independiente&pagada=1&periodo_cierre=2026-09`);assert.equal(filtrada.status,200);assert.match(await filtrada.text(),/SIN-ORDEN/);
    assert.equal((await fetch(`${base}/carburacion/facturas/pagos-proveedor`)).status,404);
    const descarga=await fetch(`${base}/carburacion/facturas/colillas/${multiple.id}/descargar`);assert.equal(descarga.status,200);assert.match(descarga.headers.get('content-type'),/application\/pdf/);
    assert.equal((await fetch(`${base}/carburacion/facturas/colillas/99999/descargar`)).status,404);
  } finally {
    if(listener)await new Promise(resolve=>listener.close(resolve));
    pool.query=originalQuery;pool.getConnection=originalConnection;
    require.cache[mailPath].exports=originalMail;
    for(const name of [...names].reverse())await originalQuery.call(pool,`DROP TABLE IF EXISTS \`${mapping[name]}\``);
    await pool.end();
  }
});
