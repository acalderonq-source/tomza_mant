const ultimas = new Map();
async function alertar(tipo, env = process.env) {
  if (!env.OPS_ALERT_WEBHOOK) return false;
  const ahora = Date.now();
  if (ahora - (ultimas.get(tipo) || 0) < 15 * 60 * 1000) return false;
  try {
    const url = new URL(env.OPS_ALERT_WEBHOOK);
    if (url.protocol !== 'https:') throw Error('HTTPS requerido');
    ultimas.set(tipo, ahora);
    const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sistema: 'Gas Tomza', evento: tipo, fecha: new Date().toISOString(), release: env.RENDER_GIT_COMMIT || 'local' }) });
    if (!response.ok) throw Error('Webhook no disponible');
    return true;
  } catch (_) { console.error('No se pudo entregar la alerta operativa:', tipo); return false; }
}
function programarRespaldo() {
  if (process.env.BACKUP_ENABLED !== 'true') return;
  let ejecutando = false;
  require('node-cron').schedule('0 2 * * *', () => {
    if (ejecutando) return;
    ejecutando = true;
    const child = require('node:child_process').spawn(process.execPath,
      [require('node:path').join(__dirname, '../scripts/respaldoEmpresa.js')], { windowsHide: true, stdio: 'inherit' });
    child.once('error', () => { ejecutando = false; void alertar('RESPALDO_FALLIDO'); });
    child.once('close', code => { ejecutando = false; if (code !== 0) void alertar('RESPALDO_FALLIDO'); });
  }, { timezone: 'America/Costa_Rica' });
}
module.exports = { alertar, programarRespaldo };
