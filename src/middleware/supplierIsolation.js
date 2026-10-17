const PORTAL = '/portal-proveedores';
// Only public presentation assets; never allow arbitrary static files or uploads.
const ASSETS = new Set([
  '/css/login.css', '/css/portal-proveedores.css', '/css/soporte-whatsapp.css',
  '/js/login.js', '/js/portal-proveedores.js', '/js/portal-facturas-taller.js',
  '/js/pwa.js', '/js/placa-search.js', '/js/loading-guard.js',
  '/img/logo_tomza.jpg', '/img/app-icon.svg', '/manifest.webmanifest',
  '/sw.js', '/offline.html', '/css/style.css', '/css/compras.css', '/css/mantenimientos.css'
]);

function isolateSupplier(req, res, next) {
  if (!req.session?.proveedorPortal) return next();
  res.set('Cache-Control', 'private, no-store');
  if (req.session.user) {
    return req.session.destroy(() => {
      res.clearCookie('tomza.sid');
      res.status(401).send('Inicie sesión nuevamente en el portal de proveedores.');
    });
  }
  let pathname;
  try { pathname = decodeURIComponent(req.path); }
  catch { return res.sendStatus(400); }
  // Reject ambiguous paths before any static handler or internal router sees them.
  if (/[\\\x00-\x1f\x7f%]/.test(pathname) || pathname.split('/').some(p => p === '.' || p === '..')) {
    return res.sendStatus(400);
  }
  if ((req.path === PORTAL || req.path.startsWith(`${PORTAL}/`)) &&
      (pathname === PORTAL || pathname.startsWith(`${PORTAL}/`))) return next();
  if (['GET', 'HEAD'].includes(req.method) && ASSETS.has(pathname)) return next();
  if (pathname === '/' && req.method === 'GET') return res.redirect(PORTAL);
  return res.status(403).send('Esta cuenta solo tiene acceso al portal de proveedores.');
}

module.exports = { isolateSupplier };
