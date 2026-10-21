(() => {
  'use strict';
  const $=selector=>document.querySelector(selector),base='/admin/informes-junta',ns='http://www.w3.org/2000/svg';
  let latest=0,blocks=[];
  const node=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;};
  const svgNode=(tag,attributes,text)=>{const n=document.createElementNS(ns,tag);Object.entries(attributes).forEach(([key,value])=>n.setAttribute(key,String(value)));if(text!=null)n.textContent=text;return n;};
  function preview() {
    const block=blocks.find(block=>String(block.slide)===$('#ij-auto-slide').value);if(!block)return;
    const svg=svgNode('svg',{viewBox:`0 0 ${block.width} ${block.height}`,role:'img','aria-label':`Diapositiva ${block.slide}, datos rellenados de ${block.sheet}`});
    svg.append(svgNode('image',{href:`${base}/api/plantillas/imagen/${block.image}`,x:0,y:0,width:block.width,height:block.height}));
    for(const cell of block.cells) {
      svg.append(svgNode('rect',{x:cell.x+1,y:cell.y+1,width:cell.w-2,height:cell.h-2,fill:'#'+cell.fill}));
      const margin=Math.min(7,cell.w*0.05),anchor=cell.align==='center'?'middle':cell.align==='right'?'end':'start';
      const x=anchor==='middle'?cell.x+cell.w/2:anchor==='end'?cell.x+cell.w-1-margin:cell.x+1+margin;
      svg.append(svgNode('text',{x,y:cell.y+cell.h/2,'text-anchor':anchor,'dominant-baseline':'central','font-family':cell.font,'font-size':cell.fontPx,'font-weight':cell.bold?700:400,'font-style':cell.italic?'italic':'normal',fill:'#'+cell.color,'data-cell':cell.address},cell.text));
    }
    $('#ij-auto-preview').replaceChildren(svg);
  }
  async function load(report) {
    const token=++latest,preferred=$('#ij-auto-slide').value;blocks=[];$('#ij-auto-preview').replaceChildren();$('#ij-auto-slide').replaceChildren();$('#ij-auto-summary').textContent='Calculando el relleno automático…';
    try {
      const response=await fetch(`${base}/api/informes/${report.id}/relleno`,{headers:{Accept:'application/json'}}),data=await response.json();
      if(!response.ok)throw new Error(data.error||'No se pudo preparar el relleno.');if(token!==latest)return;
      const title=node('h2','Relleno automático preparado'),filled=node('p',`Datos cargados: ${data.coverage.filled.join(', ')}.`),pending=node('p',`Fuentes pendientes: ${data.coverage.pending.join(', ')}.`),days=node('p',`Días de operación: ${data.coverage.days??'por confirmar'}. Se usa el calendario original de la plantilla salvo que lo cambiés en Revisar datos.`);
      $('#ij-auto-summary').replaceChildren(title,filled,pending,days,...data.coverage.warnings.map(warning=>node('p',warning)));
      const table=node('table'),head=table.createTHead().insertRow();head.append(node('th','Indicador'),node('th','Valor rellenado'));
      const body=table.createTBody();for(const item of data.excelPreview){const row=body.insertRow();row.insertCell().textContent=item.label;row.insertCell().textContent=item.value?.error?'Pendiente':Number(item.value).toLocaleString('es-CR',{maximumFractionDigits:2});}
      $('#ij-excel-preview').replaceChildren(table);
      blocks=data.blocks;const selected=preferred;
      $('#ij-auto-slide').replaceChildren(...blocks.map(block=>{const option=node('option',`${block.slide}. ${block.sheet}`);option.value=block.slide;return option;}));
      $('#ij-auto-slide').value=blocks.some(block=>String(block.slide)===selected)?selected:blocks.some(block=>block.slide===12)?'12':String(blocks[0]?.slide||'');
      preview();
      $('#ij-version').textContent=`Versión ${report.revision} · ${data.coverage.changedCells} valores y fórmulas vinculados a la fuente.`;
    }catch(error){if(token===latest)$('#ij-auto-summary').textContent=error.message;}
  }
  $('#ij-auto-slide').addEventListener('change',preview);
  const expand=node('button','Ampliar vista');expand.className='ij-btn ij-btn-outline';expand.type='button';
  $('#ij-auto-preview').after(expand);
  const dialog=node('dialog');dialog.id='ij-auto-dialog';document.body.append(dialog);
  expand.addEventListener('click',()=>{const image=$('#ij-auto-preview svg');if(!image)return;const close=node('button','Cerrar vista');close.className='ij-btn ij-btn-outline';close.addEventListener('click',()=>dialog.close());const actions=node('div');actions.className='ij-actions';actions.append(close);dialog.replaceChildren(actions,image.cloneNode(true));dialog.showModal();});
  window.addEventListener('ij:report',event=>load(event.detail));
})();
