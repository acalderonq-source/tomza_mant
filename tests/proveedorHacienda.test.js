const test = require('node:test');
const assert = require('node:assert/strict');
const {leerFacturaXML,consultarHacienda,aprobable,vencimiento}=require('../src/utils/proveedorHacienda');
const consecutivo='00100001010000000001';
const clave='506141026003101123456'+consecutivo+'112345678';
const xml=`<FacturaElectronica><Clave>${clave}</Clave><NumeroConsecutivo>${consecutivo}</NumeroConsecutivo><FechaEmision>2026-10-14T10:00:00-06:00</FechaEmision><Emisor><Nombre>Proveedor</Nombre><Identificacion><Numero>3101123456</Numero></Identificacion></Emisor><Receptor><Nombre>Tomza</Nombre><Identificacion><Numero>3101654321</Numero></Identificacion></Receptor><ResumenFactura><CodigoTipoMoneda><CodigoMoneda>CRC</CodigoMoneda></CodigoTipoMoneda><TotalComprobante>113.00</TotalComprobante></ResumenFactura></FacturaElectronica>`;
const archivo = value=>({nombre:'factura.xml',base64:Buffer.from(value).toString('base64')});

test('impuesto asumido en cero no se clasifica como excepción fiscal',()=>{
  const detalle='<DetalleServicio><LineaDetalle><CodigoComercial><Codigo>A</Codigo></CodigoComercial><Detalle>Artículo</Detalle><Cantidad>1</Cantidad><PrecioUnitario>100</PrecioUnitario><SubTotal>100</SubTotal><Impuesto><Codigo>01</Codigo><Tarifa>13</Tarifa><Monto>13</Monto></Impuesto><ImpuestoAsumidoEmisorFabrica>0.00000</ImpuestoAsumidoEmisorFabrica></LineaDetalle></DetalleServicio>';
  const contenido=xml.replace('<ResumenFactura>',detalle+'<ResumenFactura>');
  assert.deepEqual(leerFacturaXML(archivo(contenido)).observaciones_control,[]);
  assert.ok(leerFacturaXML(archivo(contenido.replace('>0.00000<','>13.00000<'))).observaciones_control.length);
});
test('lee clave sin perder ceros, exige factura XML y rechaza entidades',()=>{
  const f=leerFacturaXML(archivo(xml));assert.equal(f.clave,clave);assert.equal(f.total,113);assert.equal(f.consecutivo,consecutivo);
  assert.throws(()=>leerFacturaXML(archivo('<!DOCTYPE foo>'+xml)));
  assert.throws(()=>leerFacturaXML(archivo(xml.replaceAll('FacturaElectronica','NotaCreditoElectronica'))));
  assert.throws(()=>leerFacturaXML(archivo(xml.replace('<TotalComprobante>113.00','<TotalComprobante>-1'))));
  assert.equal(vencimiento('2026-12-20T10:00:00-06:00',30),'2027-01-19');
});
test('no aprueba XML sin aceptación real en producción',()=>{
  for(const hacienda of [{estado:'PENDIENTE'},{estado:'RECHAZADA'},{estado:'ACEPTADA',ambiente:'sandbox'}])assert.throws(()=>aprobable({electronica:{hacienda}}));
  assert.doesNotThrow(()=>aprobable({electronica:{hacienda:{estado:'ACEPTADA',ambiente:'produccion'}}}));
});
test('consulta autenticada exige clave, emisor, receptor y total de la respuesta oficial',async()=>{
  const anterior={u:process.env.HACIENDA_USUARIO,p:process.env.HACIENDA_PASSWORD,a:process.env.HACIENDA_AMBIENTE};
  process.env.HACIENDA_USUARIO='prueba';process.env.HACIENDA_PASSWORD='prueba';process.env.HACIENDA_AMBIENTE='produccion';
  const campos=leerFacturaXML(archivo(xml));let total=113,estado='aceptado',respuestaClave=clave;
  const request=async(url,options)=>{
    if(url.includes('/token'))return {ok:true,json:async()=>({access_token:'test'})};
    assert.equal(options.headers.Authorization,'Bearer test');
    return {ok:true,json:async()=>({clave:respuestaClave,'ind-estado':estado,'respuesta-xml':Buffer.from(`<MensajeHacienda><Clave>${clave}</Clave><Mensaje>1</Mensaje><NumeroCedulaEmisor>003101123456</NumeroCedulaEmisor><NumeroCedulaReceptor>003101654321</NumeroCedulaReceptor><TotalFactura>${total}</TotalFactura></MensajeHacienda>`).toString('base64')})};
  };
  try{
    assert.equal((await consultarHacienda(clave,campos,request)).estado,'ACEPTADA');
    total=114;assert.equal((await consultarHacienda(clave,campos,request)).estado,'PENDIENTE');
    estado='rechazado';assert.equal((await consultarHacienda(clave,campos,request)).estado,'RECHAZADA');
    respuestaClave='otra';assert.equal((await consultarHacienda(clave,campos,request)).estado,'PENDIENTE');
    assert.equal((await consultarHacienda(clave,campos,async()=>{throw Error('timeout');})).estado,'PENDIENTE');
    delete process.env.HACIENDA_USUARIO;assert.equal((await consultarHacienda(clave,campos,request)).estado,'PENDIENTE');
  } finally {for(const [k,v] of [['HACIENDA_USUARIO',anterior.u],['HACIENDA_PASSWORD',anterior.p],['HACIENDA_AMBIENTE',anterior.a]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});

test('reconsulta pendientes sin sobrescribir pagos y avisa cambios terminales',async()=>{
  const {actualizarHaciendaPendientes}=require('../src/utils/proveedorHaciendaPendientes');
  const u=process.env.HACIENDA_USUARIO,p=process.env.HACIENDA_PASSWORD;
  process.env.HACIENDA_USUARIO='test';process.env.HACIENDA_PASSWORD='test';
  const statements=[];
  const pool={query:async(sql,args)=>{
    statements.push({sql,args});
    if(sql.startsWith('SELECT'))return [[{id:1,datos:{factura:{numero:consecutivo,subida_en:'2026-10-14T10:00:00Z',electronica:{clave,hacienda:{estado:'PROCESANDO'}}}}}]];
    return [{affectedRows:1}];
  }};
  try{
    await actualizarHaciendaPendientes(pool,async()=>({estado:'ACEPTADA',ambiente:'produccion'}));
    assert.equal(statements.length,4);assert.match(statements[1].sql,/JSON_SET/);assert.match(statements[1].sql,/factura.subida_en/);assert.equal(statements[1].args[2],clave);assert.match(statements[2].sql,/prov_alertas/);
  }finally{if(u===undefined)delete process.env.HACIENDA_USUARIO;else process.env.HACIENDA_USUARIO=u;if(p===undefined)delete process.env.HACIENDA_PASSWORD;else process.env.HACIENDA_PASSWORD=p;}
});
