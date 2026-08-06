const crypto = require("crypto");

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

  const token = req.body?._csrf || req.get("x-csrf-token") || req.query?._csrf;
  const tokenBuffer = Buffer.from(String(token || ""));
  const sessionBuffer = Buffer.from(req.session.csrfToken);

  if (
    tokenBuffer.length === sessionBuffer.length &&
    crypto.timingSafeEqual(tokenBuffer, sessionBuffer)
  ) {
    return next();
  }

  return res.status(403).send("Solicitud no autorizada. Actualice la pagina e intente de nuevo.");
}

function injectSecurityAssets(html, csrfToken) {
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
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
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
  injectSecurityAssets
};
