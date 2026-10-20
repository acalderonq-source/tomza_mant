const test = require("node:test");
const assert = require("node:assert/strict");
const router = require("../src/routes/controlCambiosAceite.routes");
const pool = require("../src/db");

test("proyecta próxima fecha con intervalo y kilometraje mensual", () => {
  assert.equal(router.calcularFechaProximoCambio("2026-01-01", 5000, 10000), "2026-03-03");
});

test("calcula alertas de vencido, hoy, próximos 30 días y programado", () => {
  assert.equal(router.estadoProgramacion("2026-10-12", "2026-10-13").clave, "vencido");
  assert.equal(router.estadoProgramacion("2026-10-13", "2026-10-13").clave, "hoy");
  assert.equal(router.estadoProgramacion("2026-11-12", "2026-10-13").clave, "proximo");
  assert.equal(router.estadoProgramacion("2026-11-13", "2026-10-13").clave, "programado");
});

test("acepta fechas reales en formato ISO y rechaza fechas imposibles", () => {
  assert.equal(router.fechaValida("2026-02-28"), true);
  assert.equal(router.fechaValida("2026-02-30"), false);
  assert.equal(router.fechaValida("28/02/2026"), false);
});

test("inicializa solo la tabla independiente del nuevo control", async () => {
  const queryOriginal = pool.query;
  let sqlEjecutado = "";
  pool.query = async sql => { sqlEjecutado = sql; };
  try {
    await router.asegurarTablaProgramaciones();
  } finally {
    pool.query = queryOriginal;
  }
  assert.match(sqlEjecutado, /CREATE TABLE IF NOT EXISTS control_cambios_aceite_programaciones/);
  assert.doesNotMatch(sqlEjecutado, /cambios_aceite_historial|aceite_estanones|aceite_movimientos/);
});

test("incluye Granel y excluye Cisternas y Carretas del filtro Transportadora", () => {
  assert.equal(router.grupoUnidad("granel_perez_zeledon"), "granel");
  assert.equal(router.grupoUnidad("Granel"), "granel");
  assert.equal(router.grupoUnidad("Cabezales"), "transportadora");
  assert.ok(router.sedesGranel.includes("granel_alajuela"));
  assert.ok(!router.sedesTransportadora.includes("Cisternas"));
  assert.ok(!router.sedesTransportadora.includes("Carretas"));
});

test('Cartago y Tecnicos se pueden listar y guardar sin tocar inventario de aceites',async()=>{
  const express=require('express'),path=require('node:path');
  const original=pool.query;let guardadas=0;
  pool.query=async(sql,args)=>{
    assert.doesNotMatch(sql,/aceite_estanones|aceite_movimientos|cambios_aceite_historial/);
    if(sql.includes('SELECT u.id')){
      assert.equal(args[0].length,1);return [[{id:3,placa:'C123',sede:args[0][0]}]];
    }
    if(sql.includes('SELECT id FROM unidades')){
      assert.ok(args[1].includes('Cartago'));assert.ok(args[1].includes('Tecnicos'));
      assert.ok(!args[1].includes('Cisternas'));assert.ok(!args[1].includes('Carretas'));return [[{id:3}]];
    }
    if(sql.includes('INSERT INTO control_cambios_aceite_programaciones')){guardadas++;assert.equal(args[1],2000);assert.equal(args[2],5000);}
    return [[]];
  };
  const app=express();app.set('view engine','ejs');app.set('views',path.join(__dirname,'../src/views'));app.use(express.urlencoded({extended:true}));
  app.use((req,res,next)=>{req.session={user:{id:1,rol:req.query.rol||'ADMIN',departamentoActivo:'TALLER'}};next();});app.use('/control-cambios-aceite',router);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try {
    const base=`http://127.0.0.1:${server.address().port}/control-cambios-aceite`;
    for(const tipo of ['cartago','tecnicos']){
      const r=await fetch(base+'?tipo='+tipo);assert.equal(r.status,200);const html=await r.text();assert.match(html,new RegExp(`value="${tipo}" selected`));assert.match(html,/C123/);
      const post=await fetch(base+'/3',{method:'POST',redirect:'manual',body:new URLSearchParams({tipo,kilometros_mes:'2000',intervalo_km:'5000',fecha_ultimo_cambio:'2026-01-01'})});assert.equal(post.status,302);assert.equal(post.headers.get('location'),'/control-cambios-aceite?tipo='+tipo);
    }
    assert.equal(guardadas,2);
    assert.equal((await fetch(base+'?rol=SUPERVISOR')).status,403);
    assert.equal(router.grupoUnidad('Técnicos'),'tecnicos');assert.equal(router.grupoUnidad('Cartago'),'cartago');
  } finally {pool.query=original;await new Promise(r=>server.close(r));}
});
