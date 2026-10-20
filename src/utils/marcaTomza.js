function agregarMarcaTomza(html) {
  if(typeof html!=='string'||!html.includes('</head>')||html.includes('/js/marca-tomza.js'))return html;
  return html.replace('</head>','<link rel="stylesheet" href="/css/marca-tomza.css?v=1"><link rel="icon" type="image/png" href="/img/logo_tomza.png"></head>')
    .replace('</body>','<script src="/js/marca-tomza.js?v=1" defer></script></body>');
}
module.exports={agregarMarcaTomza};
