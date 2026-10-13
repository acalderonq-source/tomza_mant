(() => {
  const toggle=document.querySelector('.carb-shell-toggle'),menu=document.getElementById('carbMenu');
  if(toggle && menu){document.documentElement.classList.add('carb-menu-ready');toggle.addEventListener('click',()=>{const abierto=menu.classList.toggle('is-open');toggle.setAttribute('aria-expanded',String(abierto));});}
})();
