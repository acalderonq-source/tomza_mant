const crypto = require("crypto");
const helmet = require("helmet");

const helmetHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      // Preserve the existing CSP while legacy views still use inline scripts and CDNs.
      defaultSrc: helmet.contentSecurityPolicy.dangerouslyDisableDefaultSrc,
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"]
    }
  },
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  referrerPolicy: { policy: "same-origin" },
  strictTransportSecurity: false,
  xFrameOptions: { action: "sameorigin" }
});
const helmetHttps = helmet.strictTransportSecurity({
  maxAge: 15552000,
  includeSubDomains: false,
  preload: false
});

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function ensureCsrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }

  res.locals.csrfToken = req.session.csrfToken;

  if (!UNSAFE_METHODS.has(req.method)) {
    return next();
  }

  if (req.get('sec-fetch-site')==='cross-site' || !hasAllowedOrigin(req)) return res.status(403).send('Solicitud no autorizada.');

  const token = req.body?._csrf || req.get("x-csrf-token");
  const tokenBuffer = Buffer.from(String(token || ""));
  const sessionBuffer = Buffer.from(req.session.csrfToken);

  if (
    tokenBuffer.length === sessionBuffer.length &&
    crypto.timingSafeEqual(tokenBuffer, sessionBuffer)
  ) {
    return next();
  }

  if (isSameOriginRequest(req)) {
    return next();
  }

  return res.status(403).send("Solicitud no autorizada. Actualice la pagina e intente de nuevo.");
}

function isSameOriginRequest(req) {
  const expected = `${req.protocol||'http'}://${req.get('host')}`;
  const origin = req.get("origin");
  const referer = req.get("referer");

  for (const value of [origin, referer]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.origin === expected) return true;
    } catch (_) {
      // Ignorar cabeceras mal formadas.
    }
  }

  return false;
}

function hasAllowedOrigin(req){
  const value=req.get('origin');if(!value)return true;
  try{return new URL(value).origin===`${req.protocol||'http'}://${req.get('host')}`;}catch(_){return false;}
}

function securityHeaders(req,res,next){
  helmetHeaders(req,res,error=>{
    if(error)return next(error);
    return req.secure ? helmetHttps(req,res,next) : next();
  });
}

function bloquearRutaEstaticaPrivada(req,res,next){
  let ruta;try{ruta=decodeURIComponent(req.path);}catch(_){return res.sendStatus(400);}
  const segmentos=ruta.replace(/\\/g,'/').split('/');
  if(segmentos.includes('..')||segmentos.filter(Boolean)[0]?.toLowerCase()==='uploads')return res.sendStatus(404);
  return next();
}

function injectSecurityAssets(html, csrfToken) {
  html = require('../utils/soporteWhatsApp').injectSupport(html);
  if (typeof html !== "string" || !csrfToken) return html;

  let output = html;
  const escapedToken = escapeHtml(csrfToken);
  const csrfMeta = `\n  <meta name="csrf-token" content="${escapedToken}">`;
  const csrfScript = `
<script>
(() => {
  const token = document.querySelector('meta[name="csrf-token"]')?.content;
  if (!token || window.__tomzaCsrfFetch) return;
  window.__tomzaCsrfFetch = true;
  const originalFetch = window.fetch;
  window.fetch = function(input, init = {}) {
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, window.location.href);
    if (target.origin === window.location.origin && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const headers = new Headers(init.headers || input?.headers || {});
      if (!headers.has('x-csrf-token')) headers.set('x-csrf-token', token);
      init = { ...init, headers };
    }
    return originalFetch(input, init);
  };
})();
</script>`;

  if (!output.includes('name="csrf-token"') && output.includes("</head>")) {
    output = output.replace("</head>", `${csrfMeta}\n</head>`);
  }

  output = output.replace(/<form\b(?=[^>]*\bmethod=["']?post["']?)[^>]*>/gi, formTag => {
    if (formTag.includes('name="_csrf"') || formTag.includes("data-no-csrf")) return formTag;
    return `${formTag}\n<input type="hidden" name="_csrf" value="${escapedToken}">`;
  });

  if (!output.includes("__tomzaCsrfFetch") && output.includes("</body>")) {
    output = output.replace("</body>", `${csrfScript}\n</body>`);
  }

  return output;
}

module.exports = {
  ensureCsrfToken,
  injectSecurityAssets,
  securityHeaders,
  bloquearRutaEstaticaPrivada
};
