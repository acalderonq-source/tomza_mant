function preventAuthenticatedHtmlCaching(req, res) {
  if (req.session?.user) {
    res.setHeader("Cache-Control", "private, no-store");
  }
}

module.exports = { preventAuthenticatedHtmlCaching };
