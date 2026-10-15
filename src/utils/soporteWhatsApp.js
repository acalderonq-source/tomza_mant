function injectSupport(html) {
  if (typeof html !== 'string' || !/<body\b/i.test(html) || html.includes('id="tomza-soporte"')) return html;
  const link = 'https://wa.me/50661531228?text=' + encodeURIComponent('Hola, necesito soporte con el sistema Gas Tomza.');
  const assets = '<link rel="stylesheet" href="/css/soporte-whatsapp.css">';
  const button = `<a id="tomza-soporte" href="${link}" target="_blank" rel="noopener noreferrer" aria-label="Soporte por WhatsApp" title="Contactar soporte por WhatsApp"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-5.5a9 9 0 0 1-.9-4A8.5 8.5 0 0 1 12.5 3H13a8.5 8.5 0 0 1 8 8v.5Z"/></svg><span>Soporte</span></a>`;
  return html.replace(/<\/head\s*>/i, assets + '</head>').replace(/<\/body\s*>/i, button + '</body>');
}

module.exports = { injectSupport };
