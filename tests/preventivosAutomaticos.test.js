const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const pool = require("../src/db");
const router = require("../src/routes/preventivosSemanales.routes");
const { repartirUnidadesSemana } = require("../src/utils/preventivosSemanales");

const unidades = Array.from({ length: 19 }, (_, i) => ({ id: i + 1, placa: `C${100 + i}`, sede: i < 12 ? "Cartago" : "Guapiles" }));

test("reparte todas las unidades una vez por semana, con carga equilibrada por sede", () => {
  const reparto = repartirUnidadesSemana(unidades, "2030-01-07");
  assert.equal(reparto.length, unidades.length);
  assert.equal(new Set(reparto.map(unidad => unidad.id)).size, unidades.length);
  const cargaTotal = Array(5).fill(0);
  for (const sede of ["Cartago", "Guapiles"]) {
    const counts = Array(5).fill(0);
    for (const unidad of reparto.filter(unidad => unidad.sede === sede)) {
      const dia = new Date(unidad.fecha + "T00:00:00Z").getUTCDay();
      assert.ok(dia >= 1 && dia <= 5);
      assert.ok(unidad.fecha >= "2030-01-07" && unidad.fecha <= "2030-01-11");
      counts[dia - 1] += 1;
      cargaTotal[dia - 1] += 1;
    }
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  }
  assert.ok(Math.max(...cargaTotal) - Math.min(...cargaTotal) <= 1);
  const sedesPequenas = repartirUnidadesSemana(Array.from({ length: 7 }, (_, i) => ({ id: i, placa: `A${i}`, sede: `Sede ${i}` })), "2030-01-07");
  assert.equal(new Set(sedesPequenas.map(unidad => unidad.fecha)).size, 5);
});

async function servidor({ falla = false, rol = "TALLER" } = {}, run) {
  const queryOriginal = pool.query;
  const connectionOriginal = pool.getConnection;
  let state = [{ id: 100, unidad_id: 1, intervalo_semanas: 4, activa: 0, inicio: "2026-10-01", plan: "Plan conservado" }];
  let escrituras = 0;
  let conexiones = 0;
  pool.query = async sql => /information_schema/i.test(sql) ? [[{ total: 1 }]] : [[]];
  pool.getConnection = async () => {
    conexiones += 1;
    let local;
    return {
      async beginTransaction() { local = structuredClone(state); },
      async query(sql, params) {
        if (sql.includes("SELECT id, placa, sede FROM unidades")) {
          return [[...unidades, { id: 99, placa: "EXCLUIDA", sede: "Alajuela" }].filter(unidad => !params.length || unidad.sede === params[0])];
        }
        if (sql.includes("SELECT id, unidad_id")) return [local.filter(regla => params[0].includes(regla.unidad_id))];
        if (/UPDATE preventivos_programaciones|INSERT INTO preventivos_programaciones/.test(sql)) {
          escrituras += 1;
          if (falla && escrituras === 2) throw new Error("Fallo de prueba");
          if (sql.includes("UPDATE")) {
            assert.doesNotMatch(sql, /plan\s*=/);
            const actual = local.find(regla => regla.id === params[3]);
            Object.assign(actual, { inicio: params[0], intervalo_semanas: 1, activa: 1 });
          } else {
            local.push({ id: 100 + params[0], unidad_id: params[0], intervalo_semanas: 1, activa: 1, inicio: params[1] });
          }
          return [{ affectedRows: 1 }];
        }
        throw new Error("SQL inesperado");
      },
      async commit() { state = local; }, async rollback() {}, release() {}
    };
  };
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => { req.session = { user: { id: 2, rol } }; next(); });
  app.use("/mantenimientos/semana", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = values => fetch(`http://127.0.0.1:${server.address().port}/mantenimientos/semana/automatico`, {
    method: "POST", redirect: "manual", body: new URLSearchParams({ semana: "2030-01-07", sede: "", ...values })
  });
  try { await run({ post, getState: () => state, getWrites: () => escrituras, getConnections: () => conexiones }); }
  finally {
    pool.query = queryOriginal;
    pool.getConnection = connectionOriginal;
    await new Promise(resolve => server.close(resolve));
  }
}

test("el botón programa el ciclo completo, conserva planes y repetirlo no modifica otra vez las reglas", async () => {
  await servidor({}, async ({ post, getState, getWrites }) => {
    assert.equal((await post()).status, 302);
    assert.equal(getState().length, unidades.length);
    assert.ok(!getState().some(regla => regla.unidad_id === 99));
    assert.equal(getState().find(regla => regla.unidad_id === 1).plan, "Plan conservado");
    assert.ok(getState().every(regla => regla.intervalo_semanas === 1 && regla.activa));
    const writes = getWrites();
    assert.equal((await post()).status, 302);
    assert.equal(getWrites(), writes);
  });
});

test("el reparto respeta la sede seleccionada", async () => {
  await servidor({}, async ({ post, getState }) => {
    assert.equal((await post({ sede: "Cartago" })).status, 302);
    assert.equal(getState().length, 12);
    assert.ok(getState().every(regla => unidades.find(unidad => unidad.id === regla.unidad_id).sede === "Cartago"));
  });
});

test("si falla una unidad se revierte el reparto completo", async () => {
  await servidor({ falla: true }, async ({ post, getState }) => {
    assert.equal((await post()).status, 500);
    assert.equal(getState().length, 1);
    assert.equal(getState()[0].intervalo_semanas, 4);
    assert.equal(getState()[0].activa, 0);
  });
});

test("un mecánico no puede ejecutar la programación masiva", async () => {
  await servidor({ rol: "MECANICO" }, async ({ post, getConnections }) => {
    assert.equal((await post()).status, 403);
    assert.equal(getConnections(), 0);
  });
});
