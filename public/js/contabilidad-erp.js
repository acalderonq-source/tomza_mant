document.addEventListener('DOMContentLoaded',()=>{
 const sidebar=document.querySelector('.erp-sidebar');if(!sidebar)return;
 const url=new URL(location.href);
 // Conservar el contexto al navegar entre módulos financieros.
 document.querySelectorAll('.accounting-nav a,.erp-tile').forEach(a=>{
  const dest=new URL(a.href);if(!dest.pathname.startsWith('/contabilidad/'))return;
  for(const key of ['periodo','empresa','moneda','sede','departamento'])if(url.searchParams.has(key)&&!dest.searchParams.has(key))dest.searchParams.set(key,url.searchParams.get(key));
  a.href=dest.pathname+dest.search+dest.hash;
 });
 document.querySelectorAll('.accounting-menu').forEach(menu=>{
  document.addEventListener('click',event=>{if(!menu.contains(event.target))menu.open=false;});
  menu.addEventListener('keydown',event=>{if(event.key==='Escape'){menu.open=false;menu.querySelector('summary').focus();}});
 });
 function abrirRubro(){const target=document.getElementById(location.hash.slice(1));if(target?.matches('details.budget-drilldown')){target.open=true;target.scrollIntoView({block:'start'});}}
 window.addEventListener('hashchange',abrirRubro);abrirRubro();
 sidebar.querySelectorAll('a').forEach(a=>{const dest=new URL(a.href);if(dest.pathname===url.pathname||(a.dataset.rubro&&url.pathname.endsWith('/rubros/'+a.dataset.rubro))||(dest.pathname==='/contabilidad/planilla'&&url.pathname.endsWith('/presupuestos/planilla')))a.setAttribute('aria-current','page');});
 const search=document.getElementById('erp-module-search');if(search)search.addEventListener('input',()=>{const term=search.value.toLocaleLowerCase('es').trim();let visible=0;document.querySelectorAll('.erp-module-group').forEach(group=>{let count=0;group.querySelectorAll('.erp-tile').forEach(tile=>{tile.hidden=!tile.textContent.toLocaleLowerCase('es').includes(term);if(!tile.hidden)count++;});group.hidden=count===0;visible+=count;});document.getElementById('erp-search-empty').hidden=visible>0;});
 if(typeof HTMLDialogElement==='undefined')return;
 const dialog=document.createElement('dialog');dialog.className='erp-dialog';dialog.innerHTML='<div class="erp-dialog-head"><h2 id="erp-dialog-title"></h2><button type="button" class="erp-dialog-close" aria-label="Cerrar">×</button></div><div class="erp-dialog-content"></div>';dialog.setAttribute('aria-labelledby','erp-dialog-title');document.body.append(dialog);
 const content=dialog.querySelector('.erp-dialog-content');let origin,form,trigger;
 dialog.querySelector('button').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{if(form&&origin)origin.append(form);if(trigger)trigger.focus();form=null;});
 function open(details,button){origin=details;form=details.querySelector('form');trigger=button;const nombre=details.closest('tr')?.querySelector('td strong')?.textContent;dialog.querySelector('h2').textContent=details.querySelector('summary').textContent+(nombre?' · '+nombre:'');content.append(form);dialog.showModal();}
 document.querySelectorAll('.control-actions details,.plan-actions details,.fin-classify details').forEach(details=>{if(!details.querySelector('form'))return;const button=document.createElement('button');button.type='button';button.className='erp-row-action';button.textContent=details.querySelector('summary').textContent;button.addEventListener('click',()=>open(details,button));details.before(button);details.hidden=true;});
 const add=[...document.querySelectorAll('details')].find(d=>d.querySelector(':scope > summary')?.textContent.trim().startsWith('Agregar')&&d.querySelector('form'));
 if(add){const toolbar=document.createElement('div');toolbar.className='erp-section-toolbar';const button=document.createElement('button');button.className='btn btn-primary';button.type='button';button.textContent='+ '+add.querySelector('summary').textContent;button.addEventListener('click',()=>open(add,button));toolbar.append(button);const table=document.querySelector('.control-table,.plan-table');if(table)table.closest('section').prepend(toolbar);else add.before(toolbar);add.hidden=true;if(add.parentElement.tagName==='SECTION'&&add.parentElement.children.length===1)add.parentElement.hidden=true;}
});
