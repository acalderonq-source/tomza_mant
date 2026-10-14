const {consultarHacienda}=require('./proveedorHacienda');
let ejecutando=false;
async function actualizarHaciendaPendientes(pool, consulta=consultarHacienda) {
  if(ejecutando || !process.env.HACIENDA_USUARIO || !process.env.HACIENDA_PASSWORD)return;
  ejecutando=true;
  try {
    const [rows]=await pool.query(`SELECT id,datos FROM prov_documentos WHERE tipo IN ('oc','factura_portal')
      AND JSON_UNQUOTE(JSON_EXTRACT(datos,'$.factura.estado')) IN ('PENDIENTE','CONTABILIDAD')
      AND JSON_EXTRACT(datos,'$.factura.electronica.clave') IS NOT NULL
      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(datos,'$.factura.electronica.hacienda.estado')),'PENDIENTE') NOT IN ('ACEPTADA','RECHAZADA')
      ORDER BY JSON_UNQUOTE(JSON_EXTRACT(datos,'$.factura.electronica.hacienda.consultado_en')), id LIMIT 20`);
    for(const row of rows){
      const d=typeof row.datos==='string'?JSON.parse(row.datos):row.datos;
      const f=d.factura;
      const resultado=await consulta(f.electronica.clave,f.electronica);
      // Solo modifica la respuesta consultada: no sobrescribe aprobaciones ni pagos concurrentes.
      const [update]=await pool.query(`UPDATE prov_documentos SET datos=JSON_SET(datos,'$.factura.electronica.hacienda',CAST(? AS JSON))
        WHERE id=? AND JSON_UNQUOTE(JSON_EXTRACT(datos,'$.factura.electronica.clave'))=?
        AND JSON_UNQUOTE(JSON_EXTRACT(datos,'$.factura.subida_en'))=?
        AND JSON_UNQUOTE(JSON_EXTRACT(datos,'$.factura.electronica.hacienda.consultado_en')) <=> ?`,
        [JSON.stringify(resultado),row.id,f.electronica.clave,f.subida_en,f.electronica.hacienda?.consultado_en || null]);
      if(update.affectedRows && resultado.estado!==f.electronica.hacienda?.estado && ['ACEPTADA','RECHAZADA'].includes(resultado.estado)){
        await pool.query("INSERT INTO prov_alertas (grupo,mensaje,documento_id) VALUES ('CONTABILIDAD',?,?)",[`Hacienda: factura ${f.numero} ${resultado.estado}`,row.id]);
      }
    }
  } finally {ejecutando=false;}
}
module.exports={actualizarHaciendaPendientes};
