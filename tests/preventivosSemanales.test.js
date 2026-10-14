const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const path = require("node:path");
const pool = require("../src/db");
const router = require("../src/routes/preventivosSemanales.routes");
const { fechasProgramadas, lunesSemana, hoyCostaRica, generarPreventivos, sedeAdmitePreventivos } = require("../src/utils/preventivosSemanales");

test("repite por semanas sin desplazar el día y respeta los límites de la semana", () => {
  assert.equal(lunesSemana("2027-01-03"), "2026-12-28");
  assert.deepEqual(fechasProgramadas("2026-12-31", 2, "2026-12-28", "2027-01-31"), ["2026-12-31", "2027-01-14", "2027-01-28"]);
  assert.deepEqual(fechasProgramadas("2026-12-31", 2, "2027-01-04", "2027-01-10"), []);
  assert.throws(() => fechasProgramadas("2026-02-30", 4, "2026-01-01", "2026-03-01"));
  assert.throws(() => fechasProgramadas("2026-01-01", 0, "2026-01-01", "2026-03-01"));
  assert.equal(hoyCostaRica(new Date("2026-10-15T03:00:00Z")), "2026-10-14");
});

function baseGenerador({ falla = false, activa = true } = {}) {
  let state = { procesada: "2026-09-30", trabajos: [{ id: 1, fecha: "2026-10-08", estado: "CERRADO" }] };
  let mutex = Promise.resolve();
  let released = 0;
  return {
    get state() { return state; },
    get released() { return released; },
    async query() { return [activa && state.procesada < "2026-10-15" ? [{ id: 1, unidad_id: 10, sede: "Cartago" }] : []]; },
    async getConnection() {
      let local, unlock;
      return {
        async beginTransaction() {
          const previous = mutex;
          mutex = new Promise(resolve => { unlock = resolve; });
          await previous;
          local = structuredClone(state);
        },
        async query(sql, params) {
          if (sql.includes("SELECT id, sede FROM unidades")) return [[{ id: 10, sede: "Cartago" }]];
          if (sql.includes("SELECT p.*")) return [[{ id: 1, unidad_id: 10, inicio: "2026-10-01", intervalo_semanas: 1, procesada: local.procesada, creado_por: 2 }]];
          if (sql.includes("SELECT id FROM mantenimientos")) return [[...local.trabajos.filter(trabajo => trabajo.fecha === params[1])]];
          if (sql.includes("INSERT INTO mantenimientos")) {
            if (falla && params[2] === "2026-10-15") throw new Error("Fallo simulado");
            const id = local.trabajos.length + 1;
            local.trabajos.push({ id, fecha: params[2] });
            return [{ insertId: id }];
          }
          if (sql.includes("UPDATE preventivos_programaciones")) local.procesada = params[0];
          return [{ affectedRows: 1 }];
        },
        async commit() { state = local; unlock(); },
        async rollback() { unlock(); },
        release() { released += 1; }
      };
    }
  };
}

test("recupera fechas omitidas y no duplica un preventivo manual ni al ejecutar dos generadores", async () => {
  const db = baseGenerador();
  const resultados = await Promise.all([generarPreventivos(db, "2026-10-15"), generarPreventivos(db, "2026-10-15")]);
  assert.equal(resultados.reduce((a, b) => a + b, 0), 2);
  assert.deepEqual(db.state.trabajos.map(trabajo => trabajo.fecha).sort(), ["2026-10-01", "2026-10-08", "2026-10-15"]);
  assert.equal(db.state.procesada, "2026-10-15");
  assert.equal(await generarPreventivos(db, "2026-10-15"), 0);
  assert.equal(db.released, 2);
});

test("un fallo revierte los preventivos y el cursor para poder reintentar", async () => {
  const db = baseGenerador({ falla: true });
  await assert.rejects(generarPreventivos(db, "2026-10-15"), /Fallo simulado/);
  assert.equal(db.state.trabajos.length, 1);
  assert.equal(db.state.procesada, "2026-09-30");
  assert.equal(db.released, 1);
});

test("las programaciones pausadas no generan trabajos", async () => {
  const db = baseGenerador({ activa: false });
  assert.equal(await generarPreventivos(db, "2026-10-15"), 0);
  assert.equal(db.released, 0);
});

async function conServidor(user, handlers, run) {
  const originalQuery = pool.query;
  const originalConnection = pool.getConnection;
  pool.query = handlers.query || (async sql => /information_schema/i.test(sql) ? [[{ total: 1 }]] : [[]]);
  pool.getConnection = handlers.getConnection || (async () => { throw new Error("No debe abrir conexión"); });
  const app = express();
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "../src/views"));
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => { req.session = { user, sedeSeleccionada: "Cartago" }; next(); });
  app.use("/mantenimientos/semana", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally {
    pool.query = originalQuery;
    pool.getConnection = originalConnection;
    await new Promise(resolve => server.close(resolve));
  }
}

test("la vista semanal incluye todas las unidades, previstas y sin frecuencia, con salida escapada", async () => {
  await conServidor({ id: 2, usuario: "taller", rol: "TALLER", nombre: "Michelle Ramirez" }, {
    async query(sql, params) {
      if (sql.includes("SELECT u.id, u.placa")) {
        assert.deepEqual(params, []);
        return [[
          { id: 10, placa: "A1", sede: "Guapiles", programacion_id: 1, programacion_activa: 1, version: 1, fecha_inicio: "2026-10-14", intervalo_semanas: 4, plan: '<script>alert("x")</script>' },
          { id: 11, placa: "C2", sede: "Cartago", programacion_id: null },
          { id: 12, placa: "EXCLUIDA99", sede: "Orotina", programacion_id: null }
        ]];
      }
      return [[]];
    }
  }, async base => {
    const response = await fetch(base + "/mantenimientos/semana?semana=2026-10-14");
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /A1/);
    assert.match(html, /C2/);
    assert.match(html, /14\/10\/2026 · Previsto/);
    assert.match(html, /Sin frecuencia/);
    assert.doesNotMatch(html, /EXCLUIDA99|>Orotina</);
    assert.doesNotMatch(html, /<script>alert/);
  });
});

test("Michelle y Daniel pueden configurar frecuencias desde sus perfiles de Taller", async () => {
  for (const nombre of ["Ramírez Padilla Michelle", "Daniel Martinez"]) {
    let insert, committed = false;
    await conServidor({ id: 2, usuario: "taller", rol: "TALLER", nombre }, {
      async getConnection() { return {
        async beginTransaction() {},
        async query(sql, params) {
          if (sql.includes("SELECT id, sede FROM unidades")) return [[{ id: 10, sede: "Cartago" }]];
          if (sql.includes("SELECT id, version")) return [[]];
          if (sql.includes("INSERT INTO preventivos_programaciones")) insert = params;
          return [{ insertId: 1 }];
        },
        async commit() { committed = true; }, async rollback() {}, release() {}
      }; }
    }, async base => {
      const response = await fetch(base + "/mantenimientos/semana/programacion", {
        method: "POST", redirect: "manual", body: new URLSearchParams({unidad_id:"10",intervalo_semanas:"4",fecha_inicio:hoyCostaRica(),version:"0",activa:"1",plan:"Revisar frenos"})
      });
      assert.equal(response.status, 302);
      assert.equal(insert[2], 4);
      assert.equal(insert[3], "Revisar frenos");
      assert.equal(committed, true);
    });
  }
});

test("rechaza modificaciones de mecánicos y versiones desactualizadas sin guardar", async () => {
  await conServidor({ id: 3, rol: "MECANICO" }, {}, async base => {
    const response = await fetch(base + "/mantenimientos/semana/programacion", {method:"POST"});
    assert.equal(response.status, 403);
  });
  let rollback = false;
  await conServidor({ id: 2, rol: "TALLER" }, {
    async getConnection() { return {
      async beginTransaction() {},
      async query(sql) {
        if (sql.includes("SELECT id, sede FROM unidades")) return [[{id:10,sede:"Cartago"}]];
        if (sql.includes("SELECT id, version")) return [[{id:1,version:2}]];
        throw new Error("No debe guardar");
      },
      async commit() { throw new Error("No debe confirmar"); },
      async rollback() { rollback = true; }, release() {}
    }; }
  }, async base => {
    const response = await fetch(base + "/mantenimientos/semana/programacion", {
      method:"POST", body:new URLSearchParams({unidad_id:"10",intervalo_semanas:"4",fecha_inicio:hoyCostaRica(),version:"1",activa:"1"})
    });
    assert.equal(response.status, 409);
    assert.equal(rollback, true);
  });
});

test("excluye sedes con sus variantes de acentos y nombres internos", async () => {
  for (const sede of ["Alajuela", "Cabezales", "Carretas", "Cisternas", "Granel", "granel_cartago", "Granel Guápiles", "granel_la_cruz", "granel_perez_zeledon", "Orotina", "San Carlos", "Taller", "Tándem", "Tamden", "Técnicos", "Transportadora"]) {
    assert.equal(sedeAdmitePreventivos(sede), false, sede);
  }
  for (const sede of ["Cartago", "Guapiles", "La Cruz", "Nicoya", "Rio Claro", "Perez Zeledon", "granel_alajuela"]) {
    assert.equal(sedeAdmitePreventivos(sede), true, sede);
  }
  const db = baseGenerador();
  db.query = async () => [[{ id: 1, unidad_id: 10, sede: "Alajuela" }]];
  assert.equal(await generarPreventivos(db, "2026-10-15"), 0);
  assert.equal(db.released, 0);
});
