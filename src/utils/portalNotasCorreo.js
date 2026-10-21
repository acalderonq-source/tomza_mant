const fs=require('node:fs'),path=require('node:path');
const {UPLOAD_ROOT}=require('./uploadStorage');
async function conciliarNotasCorreo(pool,verify){
  const [rows]=await pool.query("SELECT id,datos FROM prov_documentos WHERE tipo='factura_portal' AND JSON_LENGTH(JSON_EXTRACT(datos,'$.notas_credito'))>0 ORDER BY id DESC LIMIT 100");
  let actualizadas=0;
  for(const row of rows){
    const d=typeof row.datos==='string'?JSON.parse(row.datos):row.datos;
    for(const n of d.notas_credito||[]){
      if(n.hacienda?.fuente==='CORREO_XML_FIRMADO')continue;
      const [files]=await pool.query("SELECT id,ruta_archivo FROM facturas_correo_adjuntos WHERE clave_electronica=? AND tipo_documento='XML' ORDER BY id DESC LIMIT 20",[n.clave]);
      for(const a of files){
        if(!/^[a-f\d-]+\.xml$/i.test(a.ruta_archivo))continue;
        const file=path.join(UPLOAD_ROOT,'facturas-correo',a.ruta_archivo);
        if(!fs.existsSync(file)||fs.statSync(file).size>2*1024*1024)continue;
        let v;try{v=await verify(fs.readFileSync(file,'utf8'));}catch(_){continue;}
        const m=v.mensaje,id=x=>String(x||'').replace(/^0+/,'');
        if(m.NumeroConsecutivoReceptor)continue;
        if(m.Clave!==n.clave||id(m.NumeroCedulaEmisor)!==id(n.emisor)||id(m.NumeroCedulaReceptor)!==id(n.receptor)||!Number.isFinite(Number(m.TotalFactura))||Math.abs(Number(m.TotalFactura)-n.total)>0.01)continue;
        const db=await pool.getConnection();
        try{
          await db.beginTransaction();
          const [rs]=await db.query("SELECT datos FROM prov_documentos WHERE id=? AND tipo='factura_portal' FOR UPDATE",[row.id]);
          const actual=typeof rs[0].datos==='string'?JSON.parse(rs[0].datos):rs[0].datos,nota=actual.notas_credito.find(x=>x.clave===n.clave);
          if(nota&&nota.hacienda?.fuente!=='CORREO_XML_FIRMADO'){
            nota.hacienda={estado:String(m.Mensaje)==='1'?'ACEPTADA':String(m.Mensaje)==='3'?'RECHAZADA':'ACEPTADA_PARCIAL',ambiente:'produccion',fuente:'CORREO_XML_FIRMADO',adjunto_correo_id:a.id,huella_firmante:v.huella,hash_respuesta:v.hash,consultado_en:new Date().toISOString(),detalle:'Respuesta firmada de Hacienda verificada por Outlook'};
            await db.query('UPDATE prov_documentos SET datos=? WHERE id=?',[JSON.stringify(actual),row.id]);
            await db.query('INSERT INTO prov_auditoria (documento_id,actor,accion) VALUES (?,?,?)',[row.id,'Sistema Outlook','Nota de crédito: Hacienda verificada']);actualizadas++;
          }
          await db.commit();
        }catch(e){await db.rollback();throw e;}finally{db.release();}
        break;
      }
    }
  }
  return actualizadas;
}
async function actualizarNotasAPI(pool,consulta){
  const [rows]=await pool.query("SELECT id,datos FROM prov_documentos WHERE tipo='factura_portal' AND JSON_LENGTH(JSON_EXTRACT(datos,'$.notas_credito'))>0 ORDER BY actualizado_en LIMIT 100");
  for(const row of rows){
    const d=typeof row.datos==='string'?JSON.parse(row.datos):row.datos;
    for(const n of d.notas_credito||[]){
      if(['ACEPTADA','RECHAZADA'].includes(n.hacienda?.estado))continue;
      const respuesta=await consulta(n.clave,n),db=await pool.getConnection();
      try{
        await db.beginTransaction();
        const [rs]=await db.query("SELECT datos FROM prov_documentos WHERE id=? AND tipo='factura_portal' FOR UPDATE",[row.id]);
        if(rs.length){
          const actual=typeof rs[0].datos==='string'?JSON.parse(rs[0].datos):rs[0].datos,nota=actual.notas_credito?.find(x=>x.clave===n.clave);
          if(nota&&JSON.stringify(nota.hacienda)===JSON.stringify(n.hacienda)){
            nota.hacienda=respuesta;
            await db.query('UPDATE prov_documentos SET datos=? WHERE id=?',[JSON.stringify(actual),row.id]);
            if(respuesta.estado!==n.hacienda?.estado)await db.query('INSERT INTO prov_auditoria (documento_id,actor,accion) VALUES (?,?,?)',[row.id,'Sistema Hacienda',`Nota de crédito: ${respuesta.estado}`]);
          }
        }
        await db.commit();
      }catch(e){await db.rollback();throw e;}finally{db.release();}
    }
  }
}
module.exports={conciliarNotasCorreo,actualizarNotasAPI};
