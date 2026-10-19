const outlook = require('./seguridadOutlook');
const { correoIngreso } = require('./ingresosSesion');
const { generarPDFOrden } = require('./pdfOrdenCompra');
const activos = new WeakSet();
async function preparar(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS ordenes_correo_envios (
    orden_id INT NOT NULL PRIMARY KEY, proveedor_id INT NOT NULL, correo VARCHAR(254) NULL,
    datos MEDIUMTEXT NOT NULL, estado VARCHAR(30) NOT NULL, intentos INT NOT NULL DEFAULT 0,
    error_codigo VARCHAR(80) NULL, ultimo_intento DATETIME NULL, enviado_en DATETIME NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ordenes_correo_cola (estado,intentos,ultimo_intento))`);
}
function destino(value) { try { return correoIngreso(value,true); } catch (_) { return null; } }
async function encolar(connection, id) {
  const [[orden]] = await connection.query('SELECT * FROM ordenes_compra WHERE id=?',[id]);
  if (!orden) throw Error('Orden inexistente');
  const [[proveedor]] = await connection.query('SELECT * FROM proveedores WHERE id=?',[orden.proveedor_id]);
  if (!proveedor) throw Error('Proveedor inexistente');
  const [lineas] = await connection.query('SELECT * FROM ordenes_compra_detalle WHERE orden_compra_id=?',[id]);
  const correo = destino(proveedor.email);
  await connection.query(`INSERT INTO ordenes_correo_envios (orden_id,proveedor_id,correo,datos,estado)
    VALUES (?,?,?,?,?)`,[id,orden.proveedor_id,correo,JSON.stringify({orden,proveedor,lineas}),correo?'PENDIENTE':'SIN_CORREO']);
}
async function estado(db,id) {
  try { const [rows] = await db.query('SELECT estado,correo,intentos,error_codigo,enviado_en FROM ordenes_correo_envios WHERE orden_id=?',[id]); return rows[0] || null; }
  catch(e) { if(e.code==='ER_NO_SUCH_TABLE') return null; throw e; }
}
async function reintentar(db,id) {
  const [result] = await db.query(`UPDATE ordenes_correo_envios e JOIN proveedores p ON p.id=e.proveedor_id
    SET e.correo=p.email,e.estado='PENDIENTE',e.intentos=0,e.ultimo_intento=NULL,e.error_codigo=NULL
    WHERE e.orden_id=? AND e.estado IN ('ERROR','SIN_CORREO','REVISION')`,[id]);
  return Boolean(result.affectedRows);
}
function escapar(v) { return String(v || '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function procesar(db, enviar = outlook.enviar, pdf = generarPDFOrden, env = process.env) {
  if(env.APP_ENV==='staging' || env.MAIL_ENABLED==='false' || !outlook.configurado() || activos.has(db)) return;
  activos.add(db);
  try {
    // An interrupted send may have been accepted: require human review, never resend blindly.
    await db.query("UPDATE ordenes_correo_envios SET estado='REVISION',error_codigo='ENVIO_INCIERTO' WHERE estado='ENVIANDO' AND ultimo_intento < DATE_SUB(NOW(),INTERVAL 10 MINUTE)");
    const [rows] = await db.query(`SELECT * FROM ordenes_correo_envios WHERE intentos<3 AND
      (estado='PENDIENTE' OR (estado='ERROR' AND ultimo_intento<DATE_SUB(NOW(),INTERVAL 5 MINUTE))) ORDER BY orden_id LIMIT 5`);
    for(const row of rows) {
      const [claim] = await db.query("UPDATE ordenes_correo_envios SET estado='ENVIANDO',intentos=intentos+1,ultimo_intento=NOW() WHERE orden_id=? AND estado=? AND intentos=?",[row.orden_id,row.estado,row.intentos]);
      if(!claim.affectedRows) continue;
      try {
        const correo=destino(row.correo);
        if(!correo) throw Object.assign(Error('SIN_CORREO'),{code:'SIN_CORREO'});
        const {orden,proveedor,lineas}=JSON.parse(row.datos);
        const content=await pdf(orden,proveedor,lineas);
        await enviar(db,correo,'Orden de compra '+orden.po_numero+' - Gas Tomza',
          '<p>Estimado proveedor '+escapar(proveedor.nombre)+':</p><p>Adjuntamos la orden de compra <strong>'+escapar(orden.po_numero)+'</strong> de Gas Tomza.</p>',
          undefined,[{filename:'PO_'+String(orden.po_numero).replace(/[^a-z0-9_-]/gi,'_')+'.pdf',content,contentType:'application/pdf'}]);
        await db.query("UPDATE ordenes_correo_envios SET estado='ENVIADO',enviado_en=NOW(),error_codigo=NULL WHERE orden_id=? AND estado='ENVIANDO'",[row.orden_id]);
      } catch(e) {
        const code=String(e.code || e.name || 'ENVIO_FALLIDO').replace(/[^A-Z0-9_]/gi,'').slice(0,80);
        const incierto=['TimeoutError','AbortError','TypeError','ECONNRESET','ETIMEDOUT'].includes(code);
        await db.query("UPDATE ordenes_correo_envios SET estado=?,error_codigo=? WHERE orden_id=? AND estado='ENVIANDO'",[code==='SIN_CORREO'?'SIN_CORREO':incierto?'REVISION':'ERROR',code,row.orden_id]);
      }
    }
  } catch(e) { if(e.code!=='ER_NO_SUCH_TABLE') throw e; }
  finally { activos.delete(db); }
}
function iniciar(db) {
  const timer=setInterval(()=>procesar(db).catch(e=>console.error('Envios ordenes:',e.code || 'ERROR')),60000);
  timer.unref(); return timer;
}
module.exports={preparar,encolar,estado,reintentar,procesar,iniciar,destino};
