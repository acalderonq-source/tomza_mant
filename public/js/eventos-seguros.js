(() => {
 for(const tipo of ['click','submit'])document.addEventListener(tipo,event=>{
  const node=event.target.closest?.(`[data-confirm-${tipo}]`);
  if(node&&!window.confirm(node.getAttribute(`data-confirm-${tipo}`))){event.preventDefault();event.stopImmediatePropagation();}
 },true);
 document.addEventListener('change',event=>{const node=event.target.closest?.('[data-submit-on-change]');if(node?.form)node.form.requestSubmit();});
 document.addEventListener('click',event=>{
  if(event.target.closest?.('[data-print]')){event.preventDefault();window.print();}
  if(event.target.closest?.('[data-history-back]')){event.preventDefault();window.history.back();}
 });
})();
