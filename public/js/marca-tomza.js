(() => {
  function logo() {
    const img=document.createElement('img');
    img.src='/img/logo_tomza.png';img.alt='Gas Tomza';img.width=126;img.height=40;
    img.className='tomza-brand-logo';
    return img;
  }
  document.querySelectorAll('img[src*="logo_tomza.jpg"],img[src*="logo_tomza.png"]').forEach(img=>{
    if(img.closest('[data-sin-logo],.badge-card,.badge'))return;
    img.src='/img/logo_tomza.png';img.classList.add('tomza-brand-logo');
  });
  const textos=[];
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()) {
    const node=walker.currentNode,parent=node.parentElement;
    if(!parent||!parent.closest('nav,header,h1,h2,h3,.navbar-brand,.eyebrow,.login-wordmark'))continue;
    if(parent.closest('script,style,button,select,textarea,svg,[contenteditable],[data-sin-logo]'))continue;
    if(/^\s*gas\s+tomza\s*(?:$|[·|\-–—])/i.test(node.nodeValue))textos.push(node);
  }
  for(const node of textos) {
    const parent=node.parentElement;
    // No duplicar un logo que ya identifica este mismo encabezado.
    const marca=parent.closest('.navbar-brand,.login-wordmark,.empresa-logo')||parent;
    const texto=node.nodeValue.replace(/gas\s+tomza/i,'');
    if(marca.querySelector('img'))node.replaceWith(document.createTextNode(texto));
    else node.replaceWith(logo(),document.createTextNode(texto));
  }
  document.querySelectorAll('link[rel="icon"],link[rel="shortcut icon"]').forEach(link=>{
    link.href='/img/logo_tomza.png';link.type='image/png';
  });
})();
