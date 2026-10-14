const test=require('node:test'),assert=require('node:assert/strict');
const {construir,mesesHasta,estado}=require('../src/utils/dashboardPresupuestos');
test('seis meses respetan el cambio de año y las alertas incluyen compromisos',()=>{
 assert.deepEqual(mesesHasta('2026-02'),['2025-09','2025-10','2025-11','2025-12','2026-01','2026-02']);
 assert.equal(estado({presupuesto:100,facturado:50,compromiso:40,disponible:10}),'Por revisar');
 assert.equal(estado({presupuesto:0,facturado:5,compromiso:0,disponible:-5}),'Sin presupuesto');
});
test('dashboard separa empresas, moneda, ejecución y pagos de otro mes',()=>{
 const presupuestos=[{periodo:'2026-09',empresa:'GAS TOMZA',moneda:'CRC',rubro:'SERVICIOS',monto:100,sede:'General',departamento:'GENERAL'},{periodo:'2026-09',empresa:'SUPER GAS',moneda:'CRC',rubro:'SERVICIOS',monto:200,sede:'General',departamento:'GENERAL'},{periodo:'2026-09',empresa:'GAS TOMZA',moneda:'USD',rubro:'SERVICIOS',monto:999}];
 const docs=[{id:1,fuente:'CONTROL_RUBRO',empresa:'GAS TOMZA',moneda:'CRC',fechaFactura:'2026-09-10',factura:12000,orden:0,pagos:[{fecha:'2026-10-01',monto:5000}],clasificacionPropia:{empresa:'GAS TOMZA',rubro:'SERVICIOS',moneda:'CRC',sede:'General',departamento:'GENERAL'}}];
 const entrada={docs,clasificaciones:[],presupuestos,f:{periodo:'2026-09',moneda:'CRC',empresa:'',sede:'',departamento:''}};
 const r=construir(entrada);assert.equal(r.totales.presupuesto,30000);assert.equal(r.totales.facturado,12000);assert.equal(r.totales.pagado,0);assert.equal(r.totales.disponible,18000);assert.equal(r.porEmpresa.length,2);
 const servicios=r.rubros.find(x=>x.key==='SERVICIOS');assert.equal(servicios.empresas.length,2);assert.equal(servicios.empresas.find(e=>e.empresa==='GAS TOMZA').facturado,12000);assert.equal(servicios.empresas.find(e=>e.empresa==='SUPER GAS').registros,0);assert.equal(r.porEmpresa.find(e=>e.empresa==='SUPER GAS').estado,'Sin gasto registrado');
 const filtrado=construir({...entrada,f:{...entrada.f,empresa:'SUPER GAS'}});assert.equal(filtrado.totales.presupuesto,20000);assert.equal(filtrado.totales.facturado,0);
 const octubre=construir({...entrada,f:{...entrada.f,periodo:'2026-10'}});assert.equal(octubre.totales.facturado,0);assert.equal(octubre.totales.pagado,5000);
});
