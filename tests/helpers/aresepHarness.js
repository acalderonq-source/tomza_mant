const express = require('express');
const path = require('node:path');
const { injectSecurityAssets, ensureCsrfToken } = require('../../src/middleware/security');

function crearHarness() {
  const db = {
    rows: [], history: [], calls: [], failAudit: false,
    units: [{ id: 1, placa: 'C164528', marca: 'Hino', modelo: '500', anio: 2016, sede: 'Cartago' },
      { id: 2, placa: 'C178652', marca: 'Hino', modelo: '300', anio: 2024, sede: 'Guapiles' }],
    async query(sql, args = []) {
      sql = sql.replace(/\s+/g, ' ').trim();
      this.calls.push({ sql, args });
      if (sql.startsWith('SELECT') && sql.includes('FROM unidades')) return [sql.includes('WHERE id = ?') ? this.units.filter(u => u.id === Number(args[0])) : this.units];
      if (sql.startsWith('SELECT h.version')) return [this.history.filter(h => h.registro_id === Number(args[0])).map(h => ({ ...h, usuario: 'Administrador', creado_en: new Date() }))];
      if (sql.startsWith('SELECT seccion, COUNT')) {
        const counts = {};
        this.rows.filter(r => r.periodo === args[0]).forEach(r => { counts[r.seccion] = (counts[r.seccion] || 0) + 1; });
        return [Object.entries(counts).map(([seccion, total]) => ({ seccion, total }))];
      }
      if (sql.startsWith('SELECT') && sql.includes('FROM aresep_registros')) {
        if (sql.includes('WHERE id = ?')) return [this.rows.filter(r => r.id === Number(args[0]))];
        const sections = sql.includes("seccion = 'unidades'") ? ['unidades'] : Array.isArray(args[1]) ? args[1] : [args[1]];
        return [this.rows.filter(r => r.periodo === args[0] && sections.includes(r.seccion))];
      }
      if (sql.startsWith('INSERT INTO aresep_registros')) {
        const values = sql.endsWith('VALUES ?') ? args[0] : [args];
        let insertId;
        for (const [periodo, seccion, clave, unidad_id, datos, creado_por, actualizado_por] of values) {
          if (this.rows.some(r => r.periodo === periodo && r.seccion === seccion && r.clave === clave)) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
          insertId = this.rows.length + 1;
          this.rows.push({ id: insertId, periodo, seccion, clave, unidad_id, datos, creado_por, actualizado_por, version: 1 });
        }
        return [{ insertId }];
      }
      if (sql.startsWith('UPDATE aresep_registros')) {
        const [clave, datos, version, actualizado_por, id] = args;
        const row = this.rows.find(r => r.id === id);
        if (this.rows.some(r => r.id !== id && r.periodo === row.periodo && r.seccion === row.seccion && r.clave === clave)) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
        Object.assign(row, { clave, datos, version, actualizado_por });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO aresep_historial')) {
        if (this.failAudit) throw Object.assign(new Error('Audit failed'), { code: 'TEST_AUDIT_FAILED' });
        if (sql.includes('SELECT id, version')) {
          this.rows.filter(r => r.periodo === args[0] && r.seccion === 'unidades' && args[1].includes(r.unidad_id))
            .forEach(r => this.history.push({ registro_id: r.id, version: r.version, datos: r.datos, usuario_id: r.actualizado_por }));
        } else {
          const [registro_id, version, datos, usuario_id] = args;
          this.history.push({ registro_id, version, datos, usuario_id });
        }
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async getConnection() {
      let snapshot;
      return {
        query: (...args) => this.query(...args),
        beginTransaction: async () => { snapshot = structuredClone({ rows: this.rows, history: this.history }); },
        commit: async () => {}, rollback: async () => { this.rows = snapshot.rows; this.history = snapshot.history; }, release() {}
      };
    }
  };
  require.cache[require.resolve('../../src/db')] = { exports: db };
  delete require.cache[require.resolve('../../src/routes/aresep.routes')];
  const router = require('../../src/routes/aresep.routes');
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../../src/views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, '../../public')));
  app.use((req, res, next) => {
    const role = req.get('x-test-role') || 'ADMIN';
    req.session = { csrfToken: 'test-csrf', user: role === 'ANON' ? null : { id: 1, usuario: req.get('x-test-user') || 'admin', nombre: 'Administrador de prueba', rol: role } };
    const render = res.render.bind(res);
    res.render = (view, locals) => render(view, locals, (err, html) => err ? next(err) : res.send(injectSecurityAssets(html, 'test-csrf')));
    next();
  });
  app.use(ensureCsrfToken);
  app.use('/aresep', router);
  return { app, db };
}
module.exports = { crearHarness };
