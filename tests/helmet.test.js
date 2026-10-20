const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {securityHeaders}=require('../src/middleware/security');
test('Helmet protege HTML, recursos, errores y PDFs sin romper HTTP local o HTTPS detras de Render',async()=>{
 const app=express();app.set('trust proxy',1);app.use(securityHeaders);
 app.get('/',(_req,res)=>res.send('<html><head></head><body><script>window.inlineFunciona=true</script></body></html>'));
 app.get('/documento.pdf',(_req,res)=>res.type('pdf').send(Buffer.from('%PDF-1.4\n%%EOF')));
 app.get('/recurso.js',(_req,res)=>res.type('js').send('window.recurso=true;'));
 app.use((_req,res)=>res.status(404).json({error:'No encontrado'}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base='http://127.0.0.1:'+server.address().port;
 try{
  for(const path of ['/','/documento.pdf','/recurso.js','/inexistente']){
   const response=await fetch(base+path);const h=response.headers;
   assert.equal(h.get('X-Powered-By'),null);assert.equal(h.get('X-Content-Type-Options'),'nosniff');
   assert.equal(h.get('X-Frame-Options'),'SAMEORIGIN');assert.equal(h.get('Referrer-Policy'),'same-origin');
   assert.equal(h.get('Cross-Origin-Opener-Policy'),'same-origin-allow-popups');assert.equal(h.get('Cross-Origin-Resource-Policy'),'same-origin');
   assert.equal(h.get('Origin-Agent-Cluster'),'?1');assert.equal(h.get('X-Permitted-Cross-Domain-Policies'),'none');
   assert.equal(h.get('X-XSS-Protection'),'0');assert.equal(h.get('Strict-Transport-Security'),null);
   assert.equal(h.get('Cross-Origin-Embedder-Policy'),null);
   const csp=h.get('Content-Security-Policy');assert.match(csp,/frame-ancestors 'self'/);assert.match(csp,/base-uri 'self'/);assert.match(csp,/object-src 'none'/);
   assert.doesNotMatch(csp,/upgrade-insecure-requests|default-src|script-src/);
  }
  const https=await fetch(base,{headers:{'X-Forwarded-Proto':'https'}});
  assert.equal(https.headers.get('Strict-Transport-Security'),'max-age=15552000');
  assert.match((await fetch(base+'/documento.pdf')).headers.get('Content-Type'),/application\/pdf/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
