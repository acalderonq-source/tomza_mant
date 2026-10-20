const test=require('node:test'),assert=require('node:assert/strict'),ejs=require('ejs'),fs=require('node:fs'),path=require('node:path');
const {prepararFuente,finalizarHtmlSeguro,estiloSeguro}=require('../src/utils/vistasSeguras');
test('nonces solo en codigo de plantillas, nunca en scripts inyectados por datos',()=>{
 const source=prepararFuente('<html><head><style>p{color:red}</style></head><body><%- contenido %><script>window.fiable=true;</script></body></html>');
 const html=finalizarHtmlSeguro(ejs.render(source,{cspNonce:'secreto',contenido:'<script>window.ataque=true</script>'}),'secreto');
 assert.match(html,/<script>window.ataque=true/);assert.match(html,/<script nonce="secreto">window.fiable=true/);
 assert.doesNotMatch(html,/<script nonce="secreto">window.ataque/);
});
test('eventos declarativos preservan confirmaciones, impresion, regreso y formularios sin eval',()=>{
 const source=prepararFuente(`<button onclick="return confirm('¿Eliminar <%= nombre %>?')">Quitar</button><button onclick="window.print()">Imprimir</button><select onchange="this.form.submit()"></select><button onclick="history.back()">Volver</button>`);
 const html=ejs.render(source,{nombre:'" onclick="alert(1)'});
 const tags=[];new (require('htmlparser2').Parser)({onopentag(name,attrs){tags.push(attrs);}}).end(html);
 for(const attrs of tags){assert.equal(attrs.onclick,undefined);assert.equal(attrs.onchange,undefined);}
 assert.equal(tags[0]['data-confirm-click'],'¿Eliminar " onclick="alert(1)?');
 assert.match(html,/data-confirm-click=/);assert.match(html,/data-print/);assert.match(html,/data-submit-on-change/);assert.match(html,/data-history-back/);
 assert.throws(()=>prepararFuente('<button onclick="eval(location.hash)">No</button>'),/no migrado/);
});
test('CSS inline se convierte en reglas acotadas, sin autorizar urls o rupturas de estilo',()=>{
 const html=finalizarHtmlSeguro('<html><head></head><body><p style="color:red;width:50%">Hola</p><svg><path style="fill:blue"/></svg></body></html>','nonce');
 assert.doesNotMatch(html,/\sstyle=/);assert.match(html,/style nonce="nonce"/);assert.match(html,/data-safe-style="s0"/);assert.match(html,/color:red;width:50%/);assert.match(html,/data-safe-style="s1"\/>/);
 for(const text of ['color:red}</style><script>alert(1)</script>','background:url(https://evil.test)','width:expression(alert(1))','@import "https://evil.test"','behavior:x'])assert.equal(estiloSeguro(text),null,text);
});
test('recursos externos fijos llevan integridad y las plantillas completas siguen compilando',()=>{
 const html=prepararFuente('<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>');
 assert.match(html,/integrity="sha384-/);assert.match(html,/crossorigin="anonymous"/);
 let total=0;function visitar(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())visitar(file);else if(file.endsWith('.ejs')){ejs.compile(prepararFuente(fs.readFileSync(file,'utf8')),{filename:file});total++;}}}
 visitar(path.join(__dirname,'../src/views'));assert.ok(total>100);
});
