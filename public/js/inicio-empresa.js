document.addEventListener('DOMContentLoaded',()=>{
  const toggle=document.querySelector('.menu-toggle');
  const cerrar=()=>{document.body.classList.remove('menu-open');toggle.setAttribute('aria-expanded','false');};
  toggle.addEventListener('click',()=>{const open=document.body.classList.toggle('menu-open');toggle.setAttribute('aria-expanded',String(open));});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){cerrar();toggle.focus();}});
  document.addEventListener('click',e=>{if(!e.target.closest('.empresa-menu,.menu-toggle'))cerrar();});
  const normalizar=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  document.querySelector('#buscar-departamento').addEventListener('input',e=>{
    const search=normalizar(e.target.value.trim());let count=0;
    document.querySelectorAll('.department-entry').forEach(node=>{node.hidden=!normalizar(node.dataset.name).includes(search);if(!node.hidden)count++;});
    document.querySelector('.menu-empty').hidden=count>0;
  });
  document.querySelector('#buscar-departamento').addEventListener('keydown',e=>{
    if(e.key==='Enter' && window.innerWidth<=800){e.preventDefault();document.body.classList.add('menu-open');toggle.setAttribute('aria-expanded','true');document.querySelector('.department-entry:not([hidden]) button:not(:disabled),.department-entry:not([hidden]) a')?.focus();}
  });
});
