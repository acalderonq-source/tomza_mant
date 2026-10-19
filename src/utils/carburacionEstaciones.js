const {fechaValida,fallo}=require('./carburacionFinanzas');
const {fechaActualCostaRica}=require('./fechaCostaRica');
const CATEGORIAS=[
  {key:'seguimiento',nombre:'Seguimiento',campos:[]},
  {key:'construccion',nombre:'En construcción',campos:[]},
  {key:'minae',nombre:'Trámite MINAE',campos:[['fecha','Fecha de trámite','date'],['ot','OT','textarea'],['documentacion','Envío de documentación','date'],['fiscalizacion','Fiscalización','date'],['prevencion','Prevención','date'],['prorroga','Prórroga','date'],['respuesta_prevencion','Respuesta a prevención','date'],['nueva_prevencion','Nueva prevención','date']]},
  {key:'municipal',nombre:'Permiso municipal',campos:[]},
  {key:'pendiente',nombre:'Pendiente iniciar',campos:[]},
  {key:'mantenimientos',nombre:'Mantenimientos',campos:[['ultimo_mantenimiento','Último mantenimiento','date'],['proximo_mantenimiento','Próximo mantenimiento','date'],['nota_mantenimiento','Notas de mantenimiento','textarea']]}
];
const ESTADOS=['PENDIENTE','EN_PROCESO','EN_ESPERA','FINALIZADO'];
const PRIORIDADES=['ALTA','MEDIA','BAJA','SIN_DEFINIR'];
const categoriaPorKey=key=>CATEGORIAS.find(c=>c.key===key);
const normalizar=value=>String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').toLocaleLowerCase('es-CR');
const texto=value=>value==null?'':String(value).trim();
const parseJSON=value=>typeof value==='string'?JSON.parse(value):value;
function sumarDias(fecha,dias) {
  if(!fechaValida(fecha) || !Number.isInteger(Number(dias)) || Number(dias)<1 || Number(dias)>3650)throw fallo('Revise la fecha y la frecuencia del mantenimiento.');
  const date=new Date(`${fecha}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+Number(dias));return date.toISOString().slice(0,10);
}
function mantenimientoEstado(campos,hoy=fechaActualCostaRica()) {
  const proximo=campos?.proximo_mantenimiento;
  if(!fechaValida(proximo))return 'SIN_FECHA';
  if(proximo<hoy)return 'VENCIDO';
  if(proximo===hoy)return 'HOY';
  return proximo<=sumarDias(hoy,30)?'PROXIMO':'PROGRAMADO';
}
function desdeExcel(source) {
  // Los respaldos e importaciones conservan el origen de Mejoras, ya retirado de las vistas.
  if((!categoriaPorKey(source.categoria) && source.categoria!=='mejoras') || !texto(source.estacion))throw fallo('Registro de estación inválido.');
  const v=source.valores;const registro={categoria:source.categoria,estacion:texto(source.estacion),ejecutivo:'',prioridad:'SIN_DEFINIR',estado:'PENDIENTE',detalle:'',proveedor_texto:'',campos:{}};
  if(source.categoria==='seguimiento') {
    registro.ejecutivo=texto(v[1]);registro.detalle=texto(v[3]);registro.proveedor_texto=texto(v[4]);
    if(PRIORIDADES.includes(texto(v[2]).toUpperCase()))registro.prioridad=texto(v[2]).toUpperCase();
    if(texto(v[2]).toUpperCase()==='FINALIZADO')registro.estado='FINALIZADO';
  } else if(source.categoria==='minae') {
    registro.detalle=texto(v[2]);registro.proveedor_texto=texto(v[10]);
    const columnas={fecha:0,ot:3,documentacion:4,fiscalizacion:5,prevencion:6,prorroga:7,respuesta_prevencion:8,nueva_prevencion:9};
    for(const [campo,index] of Object.entries(columnas))registro.campos[campo]=texto(v[index]);
  } else if(source.categoria==='mantenimientos') {
    const ultimo=texto(v[1]),proximo=texto(v[2]);
    registro.campos={ultimo_mantenimiento:fechaValida(ultimo)?ultimo:'',proximo_mantenimiento:'',calculo_proximo:'manual',frecuencia_dias:90,nota_mantenimiento:''};
    const formula=new RegExp(`^=B${source.fila}\\s*\\+\\s*(\\d+)$`,'i').exec(proximo);
    if(formula && fechaValida(ultimo)) {
      registro.campos.calculo_proximo='dias';registro.campos.frecuencia_dias=Number(formula[1]);registro.campos.proximo_mantenimiento=sumarDias(ultimo,Number(formula[1]));
    } else if(fechaValida(proximo))registro.campos.proximo_mantenimiento=proximo;
    else if(proximo)registro.campos.nota_mantenimiento=`Próximo mantenimiento en archivo: ${proximo}`;
    if(ultimo && !fechaValida(ultimo)) {
      registro.campos.nota_mantenimiento=[registro.campos.nota_mantenimiento,`Dato original en último mantenimiento: ${ultimo}`].filter(Boolean).join('\n');
      registro.proveedor_texto=ultimo;
    }
  } else if(source.categoria==='mejoras') {
    ['valvula','cantidad','mangueras','material','unidades'].forEach((key,i)=>{registro.campos[key]=texto(v[i+1]);});
  } else {registro.detalle=texto(v[1]);registro.proveedor_texto=texto(v[2]);}
  return registro;
}
function vincularCliente(nombre,clientes) {
  const candidatos=clientes.filter(c=>normalizar(c.nombre)===normalizar(nombre));return candidatos.length===1?candidatos[0].id:null;
}
function proveedoresExcel(value,proveedores) {
  const aliases={'ingnova':'ingnova soluciones integrales s.a.','ingnova con mantenimientos':'ingnova soluciones integrales s.a.','tecnoanalitica':'tecno analitica s.a.'};
  return [...new Set(texto(value).split(',').map(n=>{
    const target=aliases[normalizar(n)] || normalizar(n);
    const matches=proveedores.filter(p=>normalizar(p.nombre)===target);return matches.length===1?matches[0].id:null;
  }).filter(Boolean))];
}
function validarRegistro(body,categoria) {
  const config=categoriaPorKey(categoria);
  if(!config)throw fallo('Área de estaciones no encontrada.',404);
  const estacion=texto(body.estacion),ejecutivo=texto(body.ejecutivo),detalle=texto(body.detalle);
  if(!estacion || estacion.length>250 || ejecutivo.length>120 || detalle.length>15000)throw fallo('Revise el nombre de estación, ejecutivo y detalle.');
  if(!ESTADOS.includes(body.estado) || !PRIORIDADES.includes(body.prioridad))throw fallo('Seleccione un estado y una prioridad válidos.');
  const campos={};
  for(const [key,label,type] of config.campos) {
    const value=texto(body.campos?.[key]);
    if(value.length>5000 || (type==='date' && value && !fechaValida(value)))throw fallo(`Revise ${label.toLowerCase()}.`);
    campos[key]=value;
  }
  if(categoria==='mantenimientos') {
    campos.calculo_proximo=body.campos?.calculo_proximo==='dias'?'dias':'manual';
    campos.frecuencia_dias=Number(body.campos?.frecuencia_dias || 90);
    if(!Number.isInteger(campos.frecuencia_dias) || campos.frecuencia_dias<1 || campos.frecuencia_dias>3650)throw fallo('La frecuencia debe ser de 1 a 3650 días.');
    if(campos.calculo_proximo==='dias')campos.proximo_mantenimiento=campos.ultimo_mantenimiento?sumarDias(campos.ultimo_mantenimiento,campos.frecuencia_dias):'';
    if(campos.ultimo_mantenimiento && campos.proximo_mantenimiento && campos.proximo_mantenimiento<campos.ultimo_mantenimiento)throw fallo('El próximo mantenimiento no puede ser anterior al último.');
  }
  return {categoria,estacion,ejecutivo,detalle,prioridad:body.prioridad,estado:body.estado,campos};
}
module.exports={CATEGORIAS,ESTADOS,PRIORIDADES,categoriaPorKey,normalizar,parseJSON,sumarDias,mantenimientoEstado,desdeExcel,vincularCliente,proveedoresExcel,validarRegistro};
