// Integración opcional: solo tablas TEMPORARY, destruidas al cerrar la conexión.
// No crea ni modifica tablas persistentes ni eventos de producción.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db');
const s = require('../src/utils/ciberseguridad');
(async () => {
  const conn = await pool.getConnection();
  const db = { query: conn.query.bind(conn), getConnection: async () => ({ query: conn.query.bind(conn), beginTransaction: conn.beginTransaction.bind(conn), commit: conn.commit.bind(conn), rollback: conn.rollback.bind(conn), release() {} }) };
  try {
    const sql = fs.readFileSync(path.resolve(__dirname, '../migrations/202610200003_ciberseguridad_real.sql'), 'utf8').replace(/CREATE TABLE IF NOT EXISTS/g, 'CREATE TEMPORARY TABLE');
    for (const statement of sql.split(/;\s*(?:\n|$)/).filter(s => s.trim())) await conn.query(statement);
    const ahora = new Date(), req = { ip: '192.0.2.8', path: '/login', route: { path: '/login' }, ciberLoginFallido: true };
    const e = s.clasificar(req, { statusCode: 200 }, ahora);
    await s.guardarEvento(db, e); await s.guardarEvento(db, e);
    await s.guardarEvento(db, s.clasificar({ ...req, ciberLoginFallido: false }, { statusCode: 429 }, ahora));
    const f = s.filtros({ dias: '7' }, ahora), r = await s.resumenReal(db, f);
    assert.equal(r.demo, false); assert.equal(r.total, 3); assert.equal(r.bloqueados, 1); assert.equal(r.grupos, 2);
    assert.equal(r.tendencia.reduce((sum, d) => sum + d.detectados, 0), 3);
    assert.equal(r.tipos.reduce((sum, d) => sum + d.total, 0), 3);
    const row = r.incidentes.find(r => r.intentos === 2); assert.ok(row); assert.ok(Number.isFinite(Date.parse(row.fecha)));
    await s.cambiarEstado(db, row.id, { estado: 'Resuelto', nota: 'Prueba aislada en tabla temporal', version: row.version }, 1);
    await assert.rejects(s.cambiarEstado(db, row.id, { estado: 'Pendiente', nota: 'Versión obsoleta', version: row.version }, 1), { status: 409 });
    const h = await s.seguimiento(db, row.id); assert.equal(h.length, 1); assert.equal(h[0].estado, 'Resuelto');
    assert.equal((await s.resumenReal(db, f)).resueltos, 1);
    assert.equal((await s.resumenReal(db, s.filtros({ gravedad: 'Crítica' }, ahora))).total, 0);
    assert.match(await s.exportar(db, f), /EVENTOS REALES DE TOMZA/);
    console.log('MySQL: migración temporal, agrupación, resúmenes, filtros, seguimiento, conflictos y CSV verificados sin datos persistentes.');
  } finally {
    for (const tabla of ['ciberseguridad_seguimiento', 'ciberseguridad_eventos', 'ciberseguridad_config']) await conn.query(`DROP TEMPORARY TABLE IF EXISTS ${tabla}`);
    conn.release();
  }
})().catch(error => { console.error('Integración MySQL:', error.code || error.message); process.exitCode = 1; }).finally(() => pool.end());
