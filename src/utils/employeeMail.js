const crypto = require("crypto");
const { ConfidentialClientApplication } = require("@azure/msal-node");
const pool = require("../db");

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const SCOPES = ["openid", "profile", "offline_access", "User.Read", "Mail.Send"];

function ready() {
  return Boolean(process.env.MS_CLIENT_ID && process.env.MS_TENANT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_REDIRECT_URI && process.env.MAIL_TOKEN_ENCRYPTION_KEY);
}

function client() {
  return new ConfidentialClientApplication({
    auth: {
      clientId: process.env.MS_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}`,
      clientSecret: process.env.MS_CLIENT_SECRET
    }
  });
}

function key() {
  const raw = String(process.env.MAIL_TOKEN_ENCRYPTION_KEY || "").trim();
  const value = /^[a-f\d]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (value.length !== 32) throw new Error("La clave de cifrado de correo no está configurada correctamente.");
  return value;
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(part => part.toString("base64")).join(".");
}

function decrypt(value) {
  const [iv, tag, data] = String(value || "").split(".");
  if (!iv || !tag || !data) throw new Error("No se pudo descifrar la conexión de correo.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

async function ensureSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS usuario_correo_conexiones (
    usuario_id INT NOT NULL PRIMARY KEY,
    correo VARCHAR(254) NOT NULL,
    cuenta_id VARCHAR(255) NOT NULL,
    token_cache LONGTEXT NOT NULL,
    conectado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
}

async function getConnection(userId) {
  if (!userId) return null;
  await ensureSchema();
  const [rows] = await pool.query("SELECT usuario_id, correo, cuenta_id, token_cache FROM usuario_correo_conexiones WHERE usuario_id = ? LIMIT 1", [userId]);
  return rows[0] || null;
}

async function getAccessToken(userId, connection) {
  const msal = client();
  const cache = msal.getTokenCache();
  await cache.deserialize(decrypt(connection.token_cache));
  const accounts = await cache.getAllAccounts();
  const account = accounts.find(item => item.homeAccountId === connection.cuenta_id);
  if (!account) throw new Error("La sesión de Microsoft venció. Vuelva a conectar su correo.");
  const token = await msal.acquireTokenSilent({ account, scopes: SCOPES });
  await pool.query("UPDATE usuario_correo_conexiones SET token_cache = ? WHERE usuario_id = ?", [encrypt(await cache.serialize()), userId]);
  return token.accessToken;
}

async function sendAsUser(userId, { to, subject, html, cc, replyTo, attachments = [] }) {
  if (!ready()) throw new Error("La conexión Microsoft no está configurada.");
  const connection = await getConnection(userId);
  if (!connection) return false;
  const accessToken = await getAccessToken(userId, connection);
  const graphAttachments = await Promise.all(attachments.map(async file => {
    let content = file.content;
    if (typeof content === "string") content = Buffer.from(content);
    if (!content && file.path) content = require("fs").readFileSync(file.path);
    if (!Buffer.isBuffer(content)) throw new Error("No se pudo leer un adjunto del correo.");
    return {
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: file.filename || "adjunto",
      contentType: file.contentType || "application/octet-stream",
      contentBytes: content.toString("base64")
    };
  }));
  const response = await fetch(`${GRAPH_ROOT}/me/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: (Array.isArray(to) ? to : [to]).map(address => ({ emailAddress: { address } })),
        ...(cc?.length ? { ccRecipients: cc.map(address => ({ emailAddress: { address } })) } : {}),
        replyTo: [{ emailAddress: { address: connection.correo } }],
        ...(graphAttachments.length ? { attachments: graphAttachments } : {})
      },
      saveToSentItems: true
    })
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Microsoft no pudo enviar desde ${connection.correo} (${response.status}): ${detail}`);
  }
  return connection.correo;
}

module.exports = { ready, client, SCOPES, encrypt, ensureSchema, getConnection, sendAsUser };
