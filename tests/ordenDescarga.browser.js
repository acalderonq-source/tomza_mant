const assert=require('node:assert/strict');
const express=require('express');
const path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const app=express();let consultas=0;
 app.set('view engine','ejs');app.set('views',path.resolve(__dirname,'../src/views'));
 app.use(express.static(path.resolve(__dirname,'../public')));
 app.get('/detalle',(req,res)=>res.render('compras/orden_detalle',{orden:{id:1,po_numero:'2026-123',fecha:'2026-10-17',total:113,subtotal:100,descuento:0,transporte:0,iva:13,moneda:'CRC'},proveedor:{nombre:'Proveedor de prueba'},lineas:[],user:{usuario:'admin',rol:'ADMIN'},pdfUrl:'/pdf'+(req.query.fallo?'?fallo=1':''),descargarAutomaticamente:req.query.descargar==='1'}));
 app.get('/pdf',(req,res)=>{consultas++;if(req.query.fallo)return res.status(503).send('No disponible');res.attachment('PO_2026-123.pdf');res.type('pdf').send(Buffer.from('%PDF-1.4\n%%EOF'));});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
 try {
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const base='http://127.0.0.1:'+server.address().port;
 const descargar=page.waitForEvent('download');await page.goto(base+'/detalle?descargar=1');
 assert.equal((await descargar).suggestedFilename(),'PO_2026-123.pdf');
 await page.getByRole('status').filter({hasText:'Descarga del PDF solicitada'}).waitFor();
 assert.equal(new URL(page.url()).searchParams.has('descargar'),false);
 await page.reload();assert.equal(consultas,1);
 await page.goto(base+'/detalle?descargar=1&fallo=1');
 await page.getByRole('status').filter({hasText:'no se pudo descargar'}).waitFor();
 assert.equal(await page.getByRole('link',{name:'Descargar PDF'}).isVisible(),true);
 console.log('Descarga automatica OK: PDF, recarga sin repeticion, error con reintento manual.');
 } finally {await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
