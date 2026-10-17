const { registrarAuditoriaSistema } = require('./gastosOperativos');
const preparados = new WeakMap();
function prepararAuditoria(db) {
  if (!preparados.has(db)) preparados.set(db, db.query(`CREATE TABLE IF NOT EXISTS auditoria_sistema (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, modulo VARCHAR(80) NOT NULL,
    tabla_afectada VARCHAR(80) NOT NULL, registro_id BIGINT NULL, accion VARCHAR(40) NOT NULL,
    resumen VARCHAR(255) NULL, antes JSON NULL, despues JSON NULL, usuario_id INT NULL,
    usuario_nombre VARCHAR(120) NULL, creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_auditoria_modulo_fecha (modulo,creado_en),
    INDEX idx_auditoria_tabla_registro (tabla_afectada,registro_id), INDEX idx_auditoria_usuario (usuario_id)
  )`).catch(error => { preparados.delete(db); throw error; }));
  return preparados.get(db);
}
async function auditarOrden(connection, user, id, antes, despues) {
  await registrarAuditoriaSistema({ modulo: 'COMPRAS', tabla: 'ordenes_compra', registro_id: id,
    accion: antes ? 'EDITAR' : 'CREAR', resumen: antes ? 'Cambio de orden de compra' : 'Nueva orden de compra',
    antes, despues, usuario_id: user.id,
    usuario_nombre: user.persona_nombre || user.nombre_completo || user.nombre || user.usuario
  }, connection, { ensure: false });
}
module.exports = { prepararAuditoria, auditarOrden };
