function agregarNavegacionInicio(html,user) {
  if(typeof html!=='string' || !user || ['PANTALLA_MECANICOS','PANTALLA_PESADOS'].includes(user.rol))return html;
  if(html.includes('/js/ir-inicio.js'))return html;
  return html.replace('</head>','<link rel="stylesheet" href="/css/ir-inicio.css?v=1"></head>')
    .replace('</body>','<script src="/js/ir-inicio.js?v=1" defer></script></body>');
}
module.exports={agregarNavegacionInicio};
