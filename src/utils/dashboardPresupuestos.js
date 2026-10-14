const P=require('./presupuestosContabilidad');
function sumar(filas){return filas.reduce((a,r)=>{for(const k of ['presupuesto','facturado','pagado','compromiso','disponible'])a[k]+=r[k];return a;},{presupuesto:0,facturado:0,pagado:0,compromiso:0,disponible:0});}
function mesesHasta(periodo){const [a,m]=periodo.split('-').map(Number);return Array.from({length:6},(_,i)=>{const d=new Date(Date.UTC(a,m-6+i,1));return d.toISOString().slice(0,7);});}
function estado(r){const ocupado=r.facturado+r.compromiso;if(!r.presupuesto)return ocupado>0?'Sin presupuesto':'Sin movimiento';if(r.disponible<0)return 'Excedido';if(ocupado/r.presupuesto>=.9)return 'Por revisar';return 'Dentro del presupuesto';}
function construir({docs,clasificaciones,presupuestos,f}){
 const entrada={docs,clasificaciones,presupuestos,...f};const actual=P.resumen(entrada);
 const empresas=[...new Set([...presupuestos.map(p=>p.empresa),...docs.map(d=>d.empresa),...clasificaciones.map(c=>c.empresa)].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
 const empresaResultados=(f.empresa==='__SIN_EMPRESA__'?['__SIN_EMPRESA__']:empresas.filter(e=>!f.empresa||e===f.empresa)).map(empresa=>({empresa,resumen:P.resumen({...entrada,empresa})}));
 const registrados=(resultado,key)=>resultado.documentos.filter(d=>d.incluido&&(!key||d.rubro===key)&&(d.fechaFactura?.slice(0,7)===f.periodo||d.facturas?.some(x=>x.fecha.slice(0,7)===f.periodo))).length;
 const porEmpresa=empresaResultados.map(({empresa,resumen})=>({empresa,...sumar(resumen.filas),registros:registrados(resumen)})).filter(r=>r.presupuesto||r.facturado||r.pagado||r.compromiso||r.registros).map(r=>({...r,estado:!r.registros&&!r.compromiso?'Sin gasto registrado':estado(r)}));
 const rubros=actual.filas.map(r=>({...r,registros:registrados(actual,r.key),estado:!registrados(actual,r.key)&&!r.compromiso?'Sin gasto registrado':estado(r),empresas:empresaResultados.map(({empresa,resumen})=>({...resumen.filas.find(x=>x.key===r.key),empresa,registros:registrados(resumen,r.key)})).filter(e=>e.presupuesto||e.facturado||e.compromiso||e.pagado||e.registros)}));
 const tendencia=mesesHasta(f.periodo).map(periodo=>({periodo,...sumar(P.resumen({...entrada,periodo}).filas)}));
 return {totales:sumar(actual.filas),registros:registrados(actual),rubros,porEmpresa,empresas,tendencia,pendientes:actual.pendientes,documentos:actual.documentos.length,alertas:rubros.filter(r=>['Excedido','Sin presupuesto','Por revisar'].includes(r.estado))};
}
module.exports={construir,sumar,mesesHasta,estado};
