const crypto = require('node:crypto');

const SQL = `CREATE TABLE IF NOT EXISTS empresa_operaciones (
  clave CHAR(64) PRIMARY KEY, huella CHAR(64) NOT NULL,
  usuario_id INT NOT NULL, actor VARCHAR(160) NOT NULL, ruta VARCHAR(180) NOT NULL,
  estado VARCHAR(24) NOT NULL DEFAULT 'EN_PROCESO', respuesta SMALLINT NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  terminado_en TIMESTAMP NULL,
  INDEX idx_empresa_operaciones_fecha (creado_en),
  INDEX idx_empresa_operaciones_usuario (usuario_id, creado_en)
)`;
const preparaciones = new WeakMap();
function preparar(db) {
  if (!preparaciones.has(db)) {
    preparaciones.set(db, db.query(SQL).catch(error => { preparaciones.delete(db); throw error; }));
  }
  return preparaciones.get(db);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(k => !['_csrf', '_operacion'].includes(k)).map(k => [k, canonical(value[k])]));
  return value;
}
function huella(body) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(body || {}))).digest('hex');
}
function rutaProtegida(path) {
  return /^\/compras\/(ordenes|ordenes\/consignacion-consumo|facturas\/pagar-multiple|facturas\/[^/]+\/(pagar|abono))\/?$/.test(path);
}
function protegerOperaciones(db) {
  return async (req, res, next) => {
    if (req.method !== 'POST' || !rutaProtegida(req.path)) return next();
    const user = req.session?.user;
    if (!user) return res.status(401).json({ error: 'Inicie sesion nuevamente.' });
    if (!['ADMIN', 'TALLER', 'PROVEEDURIA_TALLER'].includes(user.rol)) return res.sendStatus(403);
    const token = String(req.body?._operacion || req.get('x-operation-token') || '');
    if (!/^[a-f0-9-]{36}$/i.test(token)) return res.status(428).json({ error: 'Actualice la pagina antes de guardar.' });
    const actor = String(user.persona_nombre || user.nombre_completo || user.nombre || user.usuario || user.id).slice(0, 160);
    const clave = crypto.createHash('sha256').update(`${user.id}:${req.path}:${token}`).digest('hex');
    let conexionPago;
    let liberado = false;
    const liberarPago = async () => {
      if (!conexionPago || liberado) return;
      liberado = true;
      try { await conexionPago.query("SELECT RELEASE_LOCK('gas_tomza:registro_pago')"); }
      catch (_) { conexionPago.destroy(); }
      finally { conexionPago.release(); }
    };
    try {
      await preparar(db);
      if (req.path.startsWith('/compras/facturas/')) {
        conexionPago = await db.getConnection();
        const [[lock]] = await conexionPago.query("SELECT GET_LOCK('gas_tomza:registro_pago',0) AS adquirido");
        if (Number(lock?.adquirido) !== 1) {
          conexionPago.release(); conexionPago = null;
          return res.status(409).json({ error: 'Se esta registrando otro pago. Espere unos segundos y vuelva a intentar.' });
        }
      }
      try {
        await db.query('INSERT INTO empresa_operaciones (clave,huella,usuario_id,actor,ruta) VALUES (?,?,?,?,?)',
          [clave, huella(req.body), user.id, actor, req.path]);
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        await liberarPago();
        return res.status(409).json({ error: 'Esta solicitud ya fue recibida. Revise el historial de pagos o las ordenes antes de repetirla; si hubo un error, consulte al administrador.' });
      }
      // No almacenar PDF, credenciales, cedulas ni cuerpos del formulario en el registro.
      let terminado = false;
      const registrar = estado => {
        if (terminado) return;
        terminado = true;
        void liberarPago();
        db.query('UPDATE empresa_operaciones SET estado=?, respuesta=?, terminado_en=NOW() WHERE clave=?',
          [estado, res.statusCode, clave]).catch(error => {
          console.error('No se pudo completar el registro de operacion:', error.code || 'ERROR');
          void require('./alertasEmpresa').alertar('BITACORA_OPERACION_FALLIDA');
        });
      };
      res.once('finish', () => registrar(res.statusCode >= 400 ? 'REVISAR' : 'RESPONDIDA'));
      res.once('close', () => registrar('REVISAR'));
      return next();
    } catch (error) {
      await liberarPago();
      console.error('No se pudo proteger la operacion:', error.code || 'ERROR');
      return res.status(503).json({ error: 'No se pudo verificar la solicitud. No se realizo esta operacion; intente nuevamente.' });
    }
  };
}
module.exports = { SQL, preparar, huella, rutaProtegida, protegerOperaciones };
