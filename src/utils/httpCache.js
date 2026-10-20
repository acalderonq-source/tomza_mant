function preventAuthenticatedHtmlCaching(req, res) {
  if (req.session?.user || req.session?.proveedorPortal || res.locals?.cspNonce) {
    res.setHeader("Cache-Control", "private, no-store");
  }
}

module.exports = { preventAuthenticatedHtmlCaching };
