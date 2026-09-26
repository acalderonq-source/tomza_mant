const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { ConfidentialClientApplication } = require("@azure/msal-node");
const pool = require("../db");
const { UPLOAD_ROOT, ensureUploadDirectory } = require("../utils/uploadStorage");

const router = express.Router();
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const GRAPH_SCOPES = ["openid", "profile", "offline_access", "User.Read", "Mail.Read"];
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_MESSAGES_PER_SYNC = 500;
const MAX_ATTACHMENTS_PER_SYNC = 100;
const MAX_TOTAL_BYTES_PER_SYNC = 50 * 1024 * 1024;
const ALLOWED_ROLES = new Set(["ADMIN"]);

function configReady() {
  return Boolean(
    process.env.MS_CLIENT_ID &&
    process.env.MS_TENANT_ID &&
    process.env.MS_CLIENT_SECRET &&
    process.env.MS_REDIRECT_URI &&
    process.env.MAIL_TOKEN_ENCRYPTION_KEY
  );
}

function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.redirect("/login");
  if (!ALLOWED_ROLES.has(String(req.session.user.rol || "").toUpperCase())) {
    return res.status(403).send("No autorizado");
  }
  return next();
}

function msalClient() {
  return new ConfidentialClientApplication({
    auth: {
      clientId: process.env.MS_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}`,
      clientSecret: process.env.MS_CLIENT_SECRET
    }
  });
}

function encryptionKey() {
  const raw = String(process.env.MAIL_TOKEN_ENCRYPTION_KEY || "").trim();
  const key = /^[a-f\d]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("MAIL_TOKEN_ENCRYPTION_KEY debe ser una clave base64 de 32 bytes.");
  return key;
}

function encryptCache(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64")).join(".");
}

function decryptCache(value) {
  const [ivText, tagText, dataText] = String(value || "").split(".");
  if (!ivText || !tagText || !dataText) throw new Error("La conexión guardada no se puede descifrar.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataText, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function dateForSql(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date.toISOString().slice(0, 19).replace("T", " ") : null;
}

function parseXmlInvoice(xml) {
  const tagValue = tag => {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(xml).match(new RegExp(`<(?:(?:[\\w.-]+):)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${escaped}\\s*>`, "i"));
    return match ? match[1].replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim() : null;
  };
  const money = tagValue("TotalComprobante");
  const date = tagValue("FechaEmision");
  return {
    clave: tagValue("Clave"),
    consecutivo: tagValue("NumeroConsecutivo"),
    emisor: tagValue("Nombre")?.slice(0, 180) || null,
    fecha: dateForSql(date),
    monto: money && Number.isFinite(Number(money)) ? Number(money) : null
  };
}

async function getConnection() {
  const [rows] = await pool.query("SELECT * FROM facturas_correo_conexion WHERE id = 1 LIMIT 1");
  return rows[0] || null;
}

async function getAccessToken(connection) {
  const client = msalClient();
  const cache = client.getTokenCache();
  await cache.deserialize(decryptCache(connection.token_cache));
  const accounts = await cache.getAllAccounts();
  const account = accounts.find(item => item.homeAccountId === connection.cuenta_id) || accounts[0];
  if (!account) throw new Error("La sesión Microsoft venció. Vuelva a conectar el correo.");
  const token = await client.acquireTokenSilent({ account, scopes: GRAPH_SCOPES });
  await pool.query("UPDATE facturas_correo_conexion SET token_cache = ? WHERE id = 1", [encryptCache(await cache.serialize())]);
  return token.accessToken;
}

async function graphGet(url, accessToken) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`Microsoft Graph respondió ${response.status}.`);
    error.status = response.status;
    error.detail = detail.slice(0, 500);
    throw error;
  }
  return response.json();
}

async function graphGetBytes(url, accessToken) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const error = new Error(`Microsoft Graph respondió ${response.status} al descargar un adjunto.`);
    error.status = response.status;
    throw error;
  }
  return Buffer.from(await response.arrayBuffer());
}

function safeOriginalName(value) {
  const base = path.basename(String(value || "documento")).replace(/[^\w.() -]/g, "_").slice(0, 240);
  return base || "documento";
}

async function saveAttachment(messageRowId, attachment, fileBuffer) {
  const ext = path.extname(attachment.name || "").toLowerCase();
  const type = ext === ".xml" ? "XML" : ext === ".pdf" ? "PDF" : null;
  if (!type || !fileBuffer?.length || fileBuffer.length > MAX_ATTACHMENT_BYTES) return false;

  const graphHash = crypto.createHash("sha256").update(String(attachment.id)).digest("hex");
  const [exists] = await pool.query("SELECT id FROM facturas_correo_adjuntos WHERE graph_adjunto_hash = ? LIMIT 1", [graphHash]);
  if (exists.length) return false;

  const folder = ensureUploadDirectory("facturas-correo");
  const storedName = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(folder, storedName), fileBuffer, { flag: "wx", mode: 0o600 });
  const invoice = type === "XML" ? parseXmlInvoice(fileBuffer.toString("utf8")) : {};
  try {
    await pool.query(`INSERT INTO facturas_correo_adjuntos
      (mensaje_id, graph_adjunto_hash, nombre_archivo, mime_type, ruta_archivo, tipo_documento, clave_electronica, consecutivo, emisor, fecha_emision, monto)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      messageRowId, graphHash, safeOriginalName(attachment.name), attachment.contentType || null,
      storedName, type, invoice.clave || null, invoice.consecutivo || null, invoice.emisor || null,
      invoice.fecha || null, invoice.monto ?? null
    ]);
    return true;
  } catch (error) {
    fs.rmSync(path.join(folder, storedName), { force: true });
    if (error.code === "ER_DUP_ENTRY") return false;
    throw error;
  }
}

async function attachmentAlreadySaved(attachmentId) {
  const graphHash = crypto.createHash("sha256").update(String(attachmentId)).digest("hex");
  const [rows] = await pool.query("SELECT id FROM facturas_correo_adjuntos WHERE graph_adjunto_hash = ? LIMIT 1", [graphHash]);
  return rows.length > 0;
}

async function syncInbox(accessToken) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    "$select": "id,internetMessageId,subject,from,receivedDateTime,bodyPreview,hasAttachments",
    "$filter": `receivedDateTime ge ${cutoff} and hasAttachments eq true`,
    "$orderby": "receivedDateTime desc",
    "$top": "50"
  });
  let nextUrl = `${GRAPH_ROOT}/me/mailFolders/inbox/messages?${params}`;
  let processed = 0;
  let saved = 0;
  let totalBytes = 0;
  while (nextUrl && processed < MAX_MESSAGES_PER_SYNC && saved < MAX_ATTACHMENTS_PER_SYNC && totalBytes < MAX_TOTAL_BYTES_PER_SYNC) {
    const data = await graphGet(nextUrl, accessToken);
    for (const message of data.value || []) {
      if (processed >= MAX_MESSAGES_PER_SYNC || saved >= MAX_ATTACHMENTS_PER_SYNC || totalBytes >= MAX_TOTAL_BYTES_PER_SYNC) break;
      processed += 1;
      const messageHash = crypto.createHash("sha256").update(message.id).digest("hex");
      let [rows] = await pool.query("SELECT id FROM facturas_correo_mensajes WHERE graph_id_hash = ? LIMIT 1", [messageHash]);
      if (!rows.length) {
        const from = message.from?.emailAddress;
        const [inserted] = await pool.query(`INSERT INTO facturas_correo_mensajes
          (graph_id_hash, graph_id, internet_message_id, recibido_en, remitente, asunto, vista_previa)
          VALUES (?, ?, ?, ?, ?, ?, ?)`, [
          messageHash, message.id, message.internetMessageId || null, dateForSql(message.receivedDateTime),
          from ? `${from.name || ""} <${from.address || ""}>`.trim() : null,
          message.subject || "(sin asunto)", message.bodyPreview || null
        ]);
        rows = [{ id: inserted.insertId }];
      }
      const attachments = await graphGet(`${GRAPH_ROOT}/me/messages/${encodeURIComponent(message.id)}/attachments?$select=id,name,contentType,size,isInline`, accessToken);
      for (const attachment of attachments.value || []) {
        const ext = path.extname(attachment.name || "").toLowerCase();
        if (saved >= MAX_ATTACHMENTS_PER_SYNC || totalBytes >= MAX_TOTAL_BYTES_PER_SYNC) break;
        if (attachment.isInline || ![".xml", ".pdf"].includes(ext) || Number(attachment.size || 0) > MAX_ATTACHMENT_BYTES) continue;
        if (await attachmentAlreadySaved(attachment.id)) continue;
        const attachmentUrl = `${GRAPH_ROOT}/me/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachment.id)}/$value`;
        const bytes = await graphGetBytes(attachmentUrl, accessToken);
        if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES || totalBytes + bytes.length > MAX_TOTAL_BYTES_PER_SYNC) continue;
        totalBytes += bytes.length;
        if (await saveAttachment(rows[0].id, attachment, bytes)) saved += 1;
      }
    }
    nextUrl = data["@odata.nextLink"] || null;
  }
  await pool.query("UPDATE facturas_correo_conexion SET sincronizado_en = NOW() WHERE id = 1");
  return { processed, saved };
}

router.get("/", requireAdmin, async (req, res) => {
  try {
    const connection = await getConnection();
    const [documents] = await pool.query(`SELECT a.id, a.nombre_archivo, a.tipo_documento, a.clave_electronica,
      a.consecutivo, a.emisor, a.fecha_emision, a.monto, m.remitente, m.asunto, m.recibido_en
      FROM facturas_correo_adjuntos a
      JOIN facturas_correo_mensajes m ON m.id = a.mensaje_id
      ORDER BY m.recibido_en DESC, a.id DESC LIMIT 200`);
    res.render("compras/facturas_correo", {
      user: req.session.user,
      connection,
      configured: configReady(),
      documents,
      success: req.query.ok ? String(req.query.ok) : "",
      error: req.query.error ? String(req.query.error) : ""
    });
  } catch (error) {
    console.error("No se pudo cargar la bandeja de facturas por correo:", error.message);
    res.status(500).send("No se pudo cargar la bandeja de correo.");
  }
});

router.get("/oauth/iniciar", requireAdmin, async (req, res) => {
  if (!configReady()) return res.redirect("/compras/facturas/correo?error=Falta%20configurar%20Microsoft%20365%20en%20Render.");
  try {
    const state = crypto.randomBytes(32).toString("hex");
    req.session.mailOAuthState = state;
    const url = await msalClient().getAuthCodeUrl({
      scopes: GRAPH_SCOPES,
      redirectUri: process.env.MS_REDIRECT_URI,
      state,
      prompt: "select_account"
    });
    res.redirect(url);
  } catch (error) {
    console.error("No se pudo iniciar OAuth Microsoft:", error.message);
    res.redirect("/compras/facturas/correo?error=No%20se%20pudo%20iniciar%20la%20conexi%C3%B3n.");
  }
});

router.get("/oauth/callback", requireAdmin, async (req, res) => {
  const expectedState = req.session.mailOAuthState;
  delete req.session.mailOAuthState;
  const receivedState = Buffer.from(String(req.query.state || ""));
  const expectedStateBuffer = Buffer.from(String(expectedState || ""));
  if (!expectedState || receivedState.length !== expectedStateBuffer.length || !crypto.timingSafeEqual(expectedStateBuffer, receivedState)) {
    return res.redirect("/compras/facturas/correo?error=La%20validaci%C3%B3n%20de%20seguridad%20fall%C3%B3.");
  }
  if (req.query.error || !req.query.code || !configReady()) {
    return res.redirect("/compras/facturas/correo?error=Microsoft%20cancel%C3%B3%20o%20rechaz%C3%B3%20la%20autorizaci%C3%B3n.");
  }
  try {
    const client = msalClient();
    const result = await client.acquireTokenByCode({
      code: String(req.query.code),
      scopes: GRAPH_SCOPES,
      redirectUri: process.env.MS_REDIRECT_URI
    });
    const accountId = result.account?.homeAccountId;
    const email = result.account?.username;
    if (!accountId || !email) throw new Error("Microsoft no devolvió la cuenta autorizada.");
    await pool.query(`INSERT INTO facturas_correo_conexion (id, correo, cuenta_id, token_cache, conectado_por)
      VALUES (1, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE correo = VALUES(correo), cuenta_id = VALUES(cuenta_id), token_cache = VALUES(token_cache), conectado_por = VALUES(conectado_por), conectado_en = NOW()`, [
      email, accountId, encryptCache(await client.getTokenCache().serialize()), req.session.user.id || null
    ]);
    return res.redirect("/compras/facturas/correo?ok=Correo%20corporativo%20conectado.");
  } catch (error) {
    console.error("Falló OAuth de Microsoft:", error.message);
    return res.redirect("/compras/facturas/correo?error=No%20se%20pudo%20completar%20la%20conexi%C3%B3n.");
  }
});

router.post("/sincronizar", requireAdmin, async (_req, res) => {
  try {
    if (!configReady()) return res.redirect("/compras/facturas/correo?error=Falta%20configurar%20Microsoft%20365%20en%20Render.");
    const connection = await getConnection();
    if (!connection) return res.redirect("/compras/facturas/correo?error=Primero%20conecte%20su%20correo%20corporativo.");
    const accessToken = await getAccessToken(connection);
    const result = await syncInbox(accessToken);
    const message = `Sincronización lista: ${result.saved} archivo(s) nuevo(s), ${result.processed} correo(s) revisado(s).`;
    return res.redirect(`/compras/facturas/correo?ok=${encodeURIComponent(message)}`);
  } catch (error) {
    console.error("Falló sincronización de correo Microsoft:", error.message, error.detail || "");
    const message = error.status === 401 || error.status === 403
      ? "Microsoft rechazó la lectura. Revise el consentimiento Mail.Read o vuelva a conectar la cuenta."
      : "No se pudo sincronizar. Revise la conexión Microsoft y vuelva a intentarlo.";
    return res.redirect(`/compras/facturas/correo?error=${encodeURIComponent(message)}`);
  }
});

router.post("/desconectar", requireAdmin, async (_req, res) => {
  try {
    await pool.query("DELETE FROM facturas_correo_conexion WHERE id = 1");
    return res.redirect("/compras/facturas/correo?ok=Correo%20desconectado.%20Los%20documentos%20ya%20revisados%20se%20conservan.");
  } catch (error) {
    console.error("No se pudo desconectar el correo Microsoft:", error.message);
    return res.redirect("/compras/facturas/correo?error=No%20se%20pudo%20desconectar%20el%20correo.");
  }
});

router.get("/documento/:id", requireAdmin, async (req, res) => {
  if (!/^\d+$/.test(String(req.params.id))) return res.sendStatus(404);
  try {
    const [rows] = await pool.query("SELECT nombre_archivo, ruta_archivo, tipo_documento FROM facturas_correo_adjuntos WHERE id = ? LIMIT 1", [req.params.id]);
    const document = rows[0];
    if (!document || !/^[a-f\d-]+\.(xml|pdf)$/i.test(document.ruta_archivo)) return res.sendStatus(404);
    const folder = path.resolve(UPLOAD_ROOT, "facturas-correo");
    const filePath = path.resolve(folder, document.ruta_archivo);
    if (!filePath.startsWith(`${folder}${path.sep}`) || !fs.existsSync(filePath)) return res.sendStatus(404);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type(document.tipo_documento === "PDF" ? "application/pdf" : "application/xml");
    res.setHeader("Content-Disposition", `attachment; filename="${safeOriginalName(document.nombre_archivo)}"`);
    return res.sendFile(filePath);
  } catch (error) {
    console.error("No se pudo descargar adjunto de correo:", error.message);
    return res.sendStatus(500);
  }
});

module.exports = router;
module.exports.parseXmlInvoice = parseXmlInvoice;
module.exports.encryptCache = encryptCache;
module.exports.decryptCache = decryptCache;
module.exports.syncInbox = syncInbox;
