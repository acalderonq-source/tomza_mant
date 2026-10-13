const {exigir,numero}=require('./proveeduria');
const GRUPOS=['INVENTARIO','SUMINISTRO'];
const TIPOS=['CONSUMIBLE','HERRAMIENTA','REPUESTO','OTRO'];
function cantidadInventario(valor,nombre='Cantidad') {
  const n=numero(valor,nombre);exigir(Math.abs(n*1000-Math.round(n*1000))<0.0001,`${nombre}: máximo tres decimales`);return n;
}
function fichaInventario(b){
  const d={descripcion:String(b.descripcion||'').trim(),grupo:b.grupo||'INVENTARIO',tipo:b.tipo||'OTRO',categoria:String(b.categoria||'').trim(),unidad:String(b.unidad||'UND').trim(),ubicacion:String(b.ubicacion||'').trim(),stock_minimo:cantidadInventario(b.stock_minimo??0,'Mínimo'),stock_maximo:cantidadInventario(b.stock_maximo??0,'Máximo'),proveedor:String(b.proveedor||'').trim(),iva:numero(b.iva??13,'IVA')};
  exigir(d.descripcion&&d.descripcion.length<=255&&GRUPOS.includes(d.grupo)&&TIPOS.includes(d.tipo),'Revise descripción, grupo y tipo');
  exigir(d.categoria.length<=100&&d.unidad&&d.unidad.length<=30&&d.ubicacion.length<=120&&d.proveedor.length<=255&&d.iva<=100,'Revise los datos del artículo');
  exigir(!d.stock_maximo||d.stock_maximo>=d.stock_minimo,'El máximo debe ser mayor o igual al mínimo');
  return d;
}
function estadoStock(a){return Number(a.cantidad)<=0?'AGOTADO':Number(a.stock_minimo)>0&&Number(a.cantidad)<=Number(a.stock_minimo)?'BAJO':'DISPONIBLE';}
async function guardarFichaInventario(db,sede,codigo,d){
  await db.query(`INSERT INTO prov_inventario_fichas (sede,codigo,grupo,tipo,categoria,unidad,ubicacion,stock_minimo,stock_maximo,proveedor) VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE grupo=VALUES(grupo),tipo=VALUES(tipo),categoria=VALUES(categoria),unidad=VALUES(unidad),ubicacion=VALUES(ubicacion),stock_minimo=VALUES(stock_minimo),stock_maximo=VALUES(stock_maximo),proveedor=VALUES(proveedor)`,[sede,codigo,d.grupo,d.tipo,d.categoria,d.unidad,d.ubicacion,d.stock_minimo,d.stock_maximo,d.proveedor]);
}
// Se llama después de cambiar el stock, en la misma transacción que mantiene su bloqueo.
async function registrarMovimientoInventario(db,m){
  await db.query(`INSERT INTO prov_inventario_movimientos (sede,codigo,descripcion,tipo,cantidad,existencia_anterior,existencia_nueva,documento_id,usuario_id,motivo)
    SELECT sede,codigo,descripcion,?,?,cantidad-?,cantidad,?,?,? FROM prov_inventario WHERE sede=? AND codigo=?`,[m.tipo,m.cantidad,m.cantidad,m.documento_id??null,m.usuario_id,m.motivo||'',m.sede,m.codigo]);
}
module.exports={GRUPOS,TIPOS,cantidadInventario,fichaInventario,estadoStock,guardarFichaInventario,registrarMovimientoInventario};
