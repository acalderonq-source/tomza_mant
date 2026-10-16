(()=>{
  const panel=document.querySelector('[data-taller-pendientes]');if(!panel)return;
  const resumen=panel.querySelector('[data-taller-resumen]'),tbody=panel.querySelector('[data-taller-filas]'),selector=panel.querySelector('[data-taller-proveedor]'),empresa=panel.querySelector('[data-taller-empresa]'),buscar=panel.querySelector('[data-taller-buscar]'),contador=panel.querySelector('[data-taller-contador]');let facturas=[];
  const normal=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function mostrar(){
    tbody.replaceChildren();const visibles=facturas.filter(f=>(!selector.value||String(f.proveedor_id)===selector.value)&&(!empresa.value||f.empresa===empresa.value)&&normal([f.alias,f.proveedor,f.numero,f.orden].join(' ')).includes(normal(buscar.value)));
    for(const f of visibles){
      const tr=document.createElement('tr'),moneda=n=>Number(n).toLocaleString('es-CR',{style:'currency',currency:f.moneda});
      for(const texto of [f.alias+' · '+f.proveedor,f.numero+(f.orden?' / '+f.orden:' / Sin OC registrada'),f.empresa,f.fecha+(f.vence?' · Vence '+f.vence:''),moneda(f.monto),moneda(f.credito),moneda(f.abono),moneda(f.saldo)]){const td=document.createElement('td');td.textContent=texto;tr.append(td);}
      const td=document.createElement('td');if(f.url){const a=document.createElement('a');a.href=f.url;a.textContent='Ver en Taller';td.append(a);}else td.textContent='Taller / Compras';tr.append(td);tbody.append(tr);
    }
    if(!visibles.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=9;td.textContent='No hay facturas pendientes que coincidan con la selección.';tr.append(td);tbody.append(tr);}
    const saldos={};for(const f of visibles)saldos[f.moneda]=(saldos[f.moneda]||0)+Number(f.saldo);
    contador.textContent=visibles.length+' facturas · '+Object.entries(saldos).map(([m,n])=>n.toLocaleString('es-CR',{style:'currency',currency:m})).join(' · ');
  }
  async function cargar(){
    try{
      const r=await fetch(panel.dataset.tallerPendientes);if(r.redirected){location.assign(r.url);return;}if(!r.ok)throw Error('No se pudieron consultar los pendientes de Taller.');
      const j=await r.json();facturas=j.facturas;
      for(const p of j.proveedores){const n=facturas.filter(f=>f.proveedor_id===p.id).length;const o=document.createElement('option');o.value=p.id;o.textContent=p.alias+' ('+n+')';selector.append(o);}
      for(const e of [...new Set(facturas.map(f=>f.empresa))].sort()){const o=document.createElement('option');o.value=e;o.textContent=e;empresa.append(o);}
      resumen.textContent=j.resumen.pendientes+' facturas pendientes. Saldo CRC: '+j.resumen.CRC.toLocaleString('es-CR',{style:'currency',currency:'CRC'})+' · Saldo USD: '+j.resumen.USD.toLocaleString('es-CR',{style:'currency',currency:'USD'});mostrar();
    }catch(e){resumen.textContent=e.message;const b=document.createElement('button');b.className='btn btn-sm btn-outline-primary ms-2';b.textContent='Reintentar';b.addEventListener('click',()=>{resumen.textContent='Cargando…';cargar();});resumen.append(b);}
  }
  selector.addEventListener('change',mostrar);empresa.addEventListener('change',mostrar);buscar.addEventListener('input',mostrar);cargar();
})();
