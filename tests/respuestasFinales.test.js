const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {securityHeaders}=require('../src/middleware/security');
const {noEncontrado,manejarError}=require('../src/middleware/respuestasFinales');
test('404 y errores de parser conservan CSP completa sin filtrar datos ni cache',async()=>{
 const app=express();app.use(securityHeaders);app.use(express.json());
 app.post('/login',(_req,res)=>res.sendStatus(204));
 app.get('/fallo',()=>{throw Object.assign(new Error('SECRETO_BASE_DATOS'),{status:503});});
 app.use(noEncontrado);app.use(manejarError);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{
  const base='http://127.0.0.1:'+server.address().port;
  for(const [url,options,status] of [['/robots.txt',{},404],['/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'},400],['/fallo',{},503]]){
   const r=await fetch(base+url,options);assert.equal(r.status,status);
   const csp=r.headers.get('Content-Security-Policy');
   for(const directive of ['default-src','frame-ancestors','form-action','base-uri'])assert.ok(csp.includes(directive));
   assert.equal(r.headers.get('Cache-Control'),'no-store, private');
   assert.match(r.headers.get('Content-Type'),/text\/plain/);
   assert.doesNotMatch(await r.text(),/SECRETO_BASE_DATOS|SyntaxError| at /);
  }
 }finally{await new Promise(resolve=>server.close(resolve));}
});
