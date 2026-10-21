// Guarda, por día, el resumen del Reporte General y la cobranza digitada.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { UPLOAD_ROOT } = require('../../utils/uploadStorage');

const empty = () => ({ version: 1, revision: 0, days: {}, cobranza: {}, saldos: {}, referencia: {}, history: [] });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function createStore(root = path.join(UPLOAD_ROOT, '.captura-diaria')) {
  const file = path.join(root, 'estado.json');
  let queue = Promise.resolve();
  async function load() {
    try { return { ...empty(), ...JSON.parse(await fs.readFile(file, 'utf8')) }; }
    catch (error) { if (error.code === 'ENOENT') return empty(); throw error; }
  }
  // Cada cambio se aplica en orden y se guarda con renombrado atómico.
  function update(revision, actor, change) {
    const job = queue.then(async () => {
      const state = await load();
      if (revision !== undefined && revision !== null && Number(revision) !== state.revision) throw fail('Otra persona cambió la captura. Recargue la página y vuelva a intentarlo.', 409);
      const summary = await change(state);
      state.revision += 1;
      state.updatedAt = new Date().toISOString();
      state.history = [...(state.history || []), { at: state.updatedAt, actor: String(actor || 'ADMIN'), summary }].slice(-200);
      await fs.mkdir(root, { recursive: true });
      const temp = path.join(root, `${crypto.randomUUID()}.tmp`);
      try { await fs.writeFile(temp, JSON.stringify(state), { mode: 0o600 }); await fs.rename(temp, file); }
      finally { await fs.rm(temp, { force: true }); }
      return state;
    });
    queue = job.catch(() => {});
    return job;
  }
  return { load, update };
}

module.exports = { createStore, fail };
