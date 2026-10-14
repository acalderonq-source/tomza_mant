const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),path=require('path');
const pool=require('../src/db'),router=require('../src/routes/nominaContabilidad.routes');
async function servidor(user,query,run){const original=pool.query;pool.query=query;const app=express();app.set('view engine','ejs');app.set('views',path.resolve(__dirname,'../src/views'));app.use((req,res,next)=>{req.session={user};next();});app.use('/contabilidad/planilla',router);const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));try{await run('http://127.0.0.1:'+s.address().port+'/contabilidad/planilla');}finally{await new Promise(r=>s.close(r));pool.query=original;}}
const user={id:1,rol:'CONTABILIDAD'};
test('directorio de planilla deniega roles ajenos antes de consultar datos',async()=>{
 for(const [u,status] of [[null,302],[{rol:'TALLER'},403]])await servidor(u,()=>{throw Error('No debe consultar');},async base=>assert.equal((await fetch(base,{redirect:'manual'})).status,status));
});
test('directorio pagina personas y conserva filtros con salarios cero confirmados',async()=>{
 const personas=Array.from({length:121},(_,i)=>({nombre:'Persona '+String(i).padStart(3,'0'),empresa:i<100?'GAS TOMZA':'SUPER GAS',puesto:'Operador',moneda:'CRC',salario:i<10?0:null,presupuesto:100}));
 await servidor(user,async sql=>sql.startsWith('SELECT p.*,r.salario')?[personas]:sql.startsWith('SELECT DISTINCT periodo')?[[{periodo:'2026-09'}]]:[[]],async base=>{
  const first=await fetch(base);assert.equal(first.status,200);const html=await first.text();assert.match(html,/Persona 000/);assert.match(html,/Persona 049/);assert.doesNotMatch(html,/Persona 050/);assert.match(html,/121 registros/);
  const second=await (await fetch(base+'?periodo=2026-09&pagina=2')).text();assert.match(second,/Persona 050/);assert.doesNotMatch(second,/Persona 049/);
  const filtered=await (await fetch(base+'?periodo=2026-09&empresa=SUPER%20GAS&pagina=99')).text();assert.match(filtered,/21 registros/);assert.match(filtered,/Persona 120/);assert.doesNotMatch(filtered,/Persona 000/);
  const invalid=await fetch(base+'?periodo=2026-99');assert.equal(invalid.status,400);assert.match(await invalid.text(),/No se pudo completar la operación/);
 });
});
