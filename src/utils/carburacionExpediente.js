const crypto=require('node:crypto');const pool=require('../db');
const {fallo,fechaValida}=require('./carburacionFinanzas');
const TIPOS_DOCUMENTO={CEDULA_JURIDICA:'Cédula jurídica',PODER:'Poder del representante legal',FOTO:'Fotografía',DOCUMENTO:'Documento'};
const ESTADOS_INCIDENCIA={ABIERTA:'Abierta',EN_SEGUIMIENTO:'En seguimiento',RESUELTA:'Resuelta'};
const MAX_ARCHIVO=3*1024*1024;
function leerArchivo(data,nombre){
 if(!data)return null;
 if(typeof data!=='string' || data.length>Math.ceil(MAX_ARCHIVO/3)*4+100)throw fallo('Cada archivo debe pesar como máximo 3 MB.');
 const m=/^data:(application\/pdf|image\/jpeg|image\/png|image\/webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
 if(!m)throw fallo('Adjunte un archivo PDF, JPG, PNG o WEBP.');
 const archivo=Buffer.from(m[2],'base64');
 if(!archivo.length || archivo.length>MAX_ARCHIVO || archivo.toString('base64')!==m[2])throw fallo('Archivo inválido o mayor a 3 MB.');
 const valid=m[1]==='application/pdf'?archivo.subarray(0,5).toString()==='%PDF-':m[1]==='image/jpeg'?archivo.subarray(0,3).equals(Buffer.from([255,216,255])):m[1]==='image/png'?archivo.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):archivo.subarray(0,4).toString()==='RIFF' && archivo.subarray(8,12).toString()==='WEBP';
 if(!valid)throw fallo('El contenido del archivo no corresponde a su formato.');
 const limpio=typeof nombre==='string'?nombre.split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g,'').trim():'';
 if(!limpio || limpio.length>200)throw fallo('Revise el nombre del archivo.');
 return {archivo,mime:m[1],nombre:limpio,tamanio:archivo.length,sha256:crypto.createHash('sha256').update(archivo).digest('hex')};
}
async function insertarDocumento(c,clienteId,tipo,archivo,user,representante=null){
 if(!Object.hasOwn(TIPOS_DOCUMENTO,tipo) || !archivo)throw fallo('Seleccione el tipo y el archivo del expediente.');
 if(tipo==='FOTO' && !archivo.mime.startsWith('image/'))throw fallo('Para una fotografía seleccione una imagen JPG, PNG o WEBP.');
 const [r]=await c.query(`INSERT INTO carburacion_cliente_documentos (cliente_id,tipo,nombre,mime,archivo,tamanio,sha256,representante_legal,creado_por,creado_nombre) VALUES (?,?,?,?,?,?,?,?,?,?)`,[clienteId,tipo,archivo.nombre,archivo.mime,archivo.archivo,archivo.tamanio,archivo.sha256,representante,user.id,String(user.nombre || user.usuario || 'Carburación').slice(0,160)]);
 return r.insertId;
}
async function guardarDocumento(clienteId,body,user){
 const archivo=leerArchivo(body.archivo_data,body.archivo_nombre);
 const c=await pool.getConnection();try{await c.beginTransaction();
 const [[cliente]]=await c.query('SELECT id,representante_legal FROM carburacion_clientes WHERE id=? FOR UPDATE',[clienteId]);if(!cliente)throw fallo('Cliente no encontrado.',404);
 const id=await insertarDocumento(c,clienteId,body.tipo,archivo,user,['CEDULA_JURIDICA','PODER'].includes(body.tipo)?cliente.representante_legal:null);
 await c.commit();return id;
 }catch(e){await c.rollback();throw e;}finally{c.release();}
}
async function guardarIncidencia(clienteId,body,user,id=null){
 const titulo=typeof body.titulo==='string'?body.titulo.trim():'';
 const descripcion=typeof body.descripcion==='string'?body.descripcion.trim():'';
 if(!Object.hasOwn(ESTADOS_INCIDENCIA,body.estado) || (!id && (!titulo || titulo.length>150 || !descripcion || descripcion.length>10000 || !fechaValida(body.fecha))))throw fallo('Complete título, descripción, fecha y estado de la incidencia.');
 const c=await pool.getConnection();try{await c.beginTransaction();
 const [[cliente]]=await c.query('SELECT id FROM carburacion_clientes WHERE id=? FOR UPDATE',[clienteId]);if(!cliente)throw fallo('Cliente no encontrado.',404);
 if(id){const [[antes]]=await c.query('SELECT id,version FROM carburacion_cliente_incidencias WHERE id=? AND cliente_id=? FOR UPDATE',[id,clienteId]);if(!antes)throw fallo('Incidencia no encontrada.',404);if(Number(body.version)!==antes.version)throw fallo('La incidencia cambió. Vuelva a abrir la ficha antes de guardar.',409);
 // Se conservan el reporte original y su autor; solo se actualiza el estado.
 await c.query('UPDATE carburacion_cliente_incidencias SET estado=?,version=version+1,actualizado_por=?,actualizado_en=CURRENT_TIMESTAMP WHERE id=? AND cliente_id=?',[body.estado,user.id,id,clienteId]);
 }else{const [r]=await c.query('INSERT INTO carburacion_cliente_incidencias (cliente_id,titulo,descripcion,fecha,estado,creado_por,creado_nombre) VALUES (?,?,?,?,?,?,?)',[clienteId,titulo,descripcion,body.fecha,body.estado,user.id,String(user.nombre || user.usuario || 'Carburación').slice(0,160)]);id=r.insertId;}
 await c.commit();return id;
 }catch(e){await c.rollback();throw e;}finally{c.release();}
}
module.exports={TIPOS_DOCUMENTO,ESTADOS_INCIDENCIA,MAX_ARCHIVO,leerArchivo,insertarDocumento,guardarDocumento,guardarIncidencia};
