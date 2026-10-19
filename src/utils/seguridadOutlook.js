const crypto = require('node:crypto');
const { ConfidentialClientApplication } = require('@azure/msal-node');
const scopes = ['openid', 'profile', 'offline_access', 'User.Read', 'Mail.Send'];
const redirectUri = 'https://tomza-mant.onrender.com/admin/ingresos/correo/callback';
function configurado() { return Boolean(process.env.MS_SEGURIDAD_CLIENT_ID && process.env.MS_SEGURIDAD_CLIENT_SECRET); }
function esperado() { return String(process.env.EMAIL_USER_SEGURIDAD || 'gastomzasis@outlook.com').trim().toLowerCase(); }
function fallo(code) { return Object.assign(Error(code), { code }); }
function clave() {
  if (!configurado()) throw fallo('OUTLOOK_NO_CONFIGURADO');
  return crypto.createHash('sha256').update(process.env.MS_SEGURIDAD_CLIENT_SECRET).digest();
}
function cifrar(texto) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', clave(), iv);
  const data = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}
function descifrar(texto) {
  const [iv, tag, data] = texto.split('.').map(v => Buffer.from(v, 'base64'));
  const cipher = crypto.createDecipheriv('aes-256-gcm', clave(), iv); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}
function cliente() {
  if (!configurado()) throw fallo('OUTLOOK_NO_CONFIGURADO');
  return new ConfidentialClientApplication({ auth: { clientId: process.env.MS_SEGURIDAD_CLIENT_ID,
    clientSecret: process.env.MS_SEGURIDAD_CLIENT_SECRET, authority: 'https://login.microsoftonline.com/consumers' } });
}
async function preparar(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS seguridad_outlook_conexion (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY, correo VARCHAR(254) NOT NULL,
    cuenta_id VARCHAR(255) NOT NULL, token_cache MEDIUMTEXT NOT NULL,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);
}
async function estado(db) {
  try { const [rows] = await db.query('SELECT correo FROM seguridad_outlook_conexion WHERE id=1'); return rows[0]?.correo || ''; }
  catch (e) { if (e.code === 'ER_NO_SUCH_TABLE') return ''; throw e; }
}
function validarCuenta(correo) { if (String(correo || '').toLowerCase() !== esperado()) throw fallo('OUTLOOK_CUENTA_INCORRECTA'); }
async function iniciar(session) {
  const state = crypto.randomBytes(32).toString('hex'), verifier = crypto.randomBytes(32).toString('base64url');
  session.seguridadOAuth = { state, verifier, fecha: Date.now() };
  return cliente().getAuthCodeUrl({ scopes, redirectUri, state, codeChallengeMethod: 'S256',
    codeChallenge: crypto.createHash('sha256').update(verifier).digest('base64url'), prompt: 'select_account', loginHint: esperado() });
}
function consumirEstado(session, state) {
  const auth = session.seguridadOAuth; delete session.seguridadOAuth;
  if (!auth || typeof state !== 'string' || state !== auth.state || Date.now()-auth.fecha > 600000) throw fallo('OUTLOOK_ESTADO_INVALIDO');
  return auth;
}
async function conectar(db, auth, code, fetcher = fetch) {
  if (typeof code !== 'string' || !code) throw fallo('OUTLOOK_AUTORIZACION_CANCELADA');
  const client = cliente();
  const token = await client.acquireTokenByCode({ scopes, redirectUri, code, codeVerifier: auth.verifier });
  const response = await fetcher('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
    headers: { Authorization: 'Bearer '+token.accessToken }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw fallo('OUTLOOK_PERFIL_RECHAZADO');
  const profile = await response.json(), correo = String(profile.mail || profile.userPrincipalName || '').toLowerCase();
  validarCuenta(correo);
  await preparar(db);
  await db.query(`INSERT INTO seguridad_outlook_conexion (id,correo,cuenta_id,token_cache) VALUES (1,?,?,?)
    ON DUPLICATE KEY UPDATE correo=VALUES(correo),cuenta_id=VALUES(cuenta_id),token_cache=VALUES(token_cache)`,
  [correo, token.account.homeAccountId, cifrar(client.getTokenCache().serialize())]);
  return correo;
}
async function enviar(db, to, subject, html, fetcher = fetch, attachments = []) {
  const adjuntos = attachments.map(a => {
    if (!Buffer.isBuffer(a.content) || a.content.length > 2500000) throw fallo('OUTLOOK_ADJUNTO_INVALIDO');
    return { '@odata.type':'#microsoft.graph.fileAttachment', name:a.filename,
      contentType:a.contentType || 'application/pdf', contentBytes:a.content.toString('base64') };
  });
  let row;
  try { const [rows] = await db.query('SELECT * FROM seguridad_outlook_conexion WHERE id=1'); row = rows[0]; }
  catch (e) { if (e.code === 'ER_NO_SUCH_TABLE') throw fallo('OUTLOOK_NO_VINCULADO'); throw e; }
  if (!row) throw fallo('OUTLOOK_NO_VINCULADO');
  validarCuenta(row.correo);
  const client = cliente(); client.getTokenCache().deserialize(descifrar(row.token_cache));
  const account = (await client.getTokenCache().getAllAccounts()).find(a => a.homeAccountId === row.cuenta_id);
  if (!account) throw fallo('OUTLOOK_REVINCULAR');
  let token;
  try { token = await client.acquireTokenSilent({ scopes, account }); }
  catch (_) { throw fallo('OUTLOOK_REVINCULAR'); }
  // Persist refreshed tokens before sending, without overwriting a newly linked account.
  const [saved] = await db.query('UPDATE seguridad_outlook_conexion SET token_cache=? WHERE id=1 AND token_cache=?',
    [cifrar(client.getTokenCache().serialize()), row.token_cache]);
  if (!saved.affectedRows) throw fallo('OUTLOOK_CONEXION_CAMBIO');
  const response = await fetcher('https://graph.microsoft.com/v1.0/me/sendMail', { method: 'POST',
    headers: { Authorization: 'Bearer '+token.accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { subject, body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: to } }], ...(adjuntos.length ? { attachments:adjuntos } : {}) }, saveToSentItems: true }), signal: AbortSignal.timeout(20000) });
  if (response.status !== 202) throw fallo(response.status === 401 ? 'OUTLOOK_REVINCULAR' : response.status === 403 ? 'OUTLOOK_PERMISO_DENEGADO' : 'OUTLOOK_ENVIO_RECHAZADO');
}
module.exports = { configurado, esperado, estado, iniciar, consumirEstado, conectar, enviar, cifrar, descifrar, validarCuenta };
