const pool=require('../db');
const {fallo}=require('./carburacionFinanzas');
const {cedulaValida}=require('./cedula');
const {correoValido}=require('./pagoProveedorCorreo');
const CAMPOS_CLIENTE=[
  {key:'nombre',label:'Nombre de la gasolinera',max:150,grupo:'identificacion',required:true},
  {key:'razon_social',label:'Razón social',max:200,grupo:'identificacion'},
  {key:'cedula_juridica',label:'Cédula jurídica',max:40,grupo:'identificacion'},
  {key:'representante_legal',label:'Representante legal',max:200,grupo:'identificacion'},
  {key:'tipo_actividad',label:'Tipo de actividad',max:200,grupo:'identificacion'},
  {key:'codigo_minae',label:'Código MINAE',max:100,grupo:'identificacion'},
  {key:'provincia',label:'Provincia',max:100,grupo:'ubicacion'},
  {key:'canton',label:'Cantón',max:100,grupo:'ubicacion'},
  {key:'distrito',label:'Distrito',max:100,grupo:'ubicacion'},
  {key:'direccion',label:'Dirección exacta de la gasolinera',max:3000,grupo:'ubicacion',type:'textarea'},
  {key:'correo_notificacion',label:'Correo electrónico para notificar',max:200,grupo:'contacto',type:'email'},
  {key:'telefono_notificacion',label:'Número de contacto para notificar',max:40,grupo:'contacto',type:'tel'}
];
function validarFicha(body) {
  const values={};
  for(const campo of CAMPOS_CLIENTE) {
    const raw=body[campo.key];
    if(raw!=null && typeof raw!=='string')throw fallo(`Revise ${campo.label.toLowerCase()}.`);
    const value=String(raw || '').trim();
    if((campo.required && !value) || value.length>campo.max)throw fallo(`Revise ${campo.label.toLowerCase()}.`);
    values[campo.key]=value || null;
  }
  if(!cedulaValida(values.cedula_juridica))throw fallo('La cédula jurídica debe contener de 9 a 12 dígitos; puede incluir guiones.');
  if(values.correo_notificacion && !correoValido(values.correo_notificacion))throw fallo('Ingrese un correo electrónico válido.');
  if(values.telefono_notificacion && !/^[+\d\s().-]+$/.test(values.telefono_notificacion))throw fallo('Revise el número de contacto para notificar.');
  if(values.correo_notificacion)values.correo_notificacion=values.correo_notificacion.toLowerCase();
  return values;
}
async function puedeEditarClientes(user) {
  if(user?.departamentoActivo!=='CARBURACION' || !user.departamentos?.includes('CARBURACION'))return false;
  if(user.rol==='ADMIN')return true;
  const [[permiso]]=await pool.query('SELECT usuario_id FROM carburacion_cliente_editores WHERE usuario_id=?',[user.id]);
  return Boolean(permiso);
}
async function guardarFicha(id,body,user) {
  const datos=validarFicha(body);
  const connection=await pool.getConnection();
  try {
    await connection.beginTransaction();let antes=null;
    if(id) {
      [[antes]]=await connection.query('SELECT * FROM carburacion_clientes WHERE id=? FOR UPDATE',[id]);
      if(!antes)throw fallo('Cliente no encontrado.',404);
      if(Number(body.version)!==antes.version)throw fallo('La ficha cambió mientras la editaba. Vuelva a abrirla antes de guardar.',409);
      await connection.query(`UPDATE carburacion_clientes SET ${CAMPOS_CLIENTE.map(c=>`${c.key}=?`).join(',')},version=version+1,actualizado_por=?,actualizado_en=CURRENT_TIMESTAMP WHERE id=?`,
        [...CAMPOS_CLIENTE.map(c=>datos[c.key]),user.id,id]);
    } else {
      const [result]=await connection.query(`INSERT INTO carburacion_clientes (${CAMPOS_CLIENTE.map(c=>c.key).join(',')},creado_por,actualizado_por,actualizado_en) VALUES (${CAMPOS_CLIENTE.map(()=>'?').join(',')},?,?,CURRENT_TIMESTAMP)`,
        [...CAMPOS_CLIENTE.map(c=>datos[c.key]),user.id,user.id]);
      id=result.insertId;
    }
    await connection.query(`INSERT INTO carburacion_clientes_historial (cliente_id,accion,antes_json,despues_json,usuario_id,usuario_nombre) VALUES (?,?,?,?,?,?)`,
      [id,antes?'EDICION':'CREACION',antes?JSON.stringify(Object.fromEntries(CAMPOS_CLIENTE.map(c=>[c.key,antes[c.key]]))):null,JSON.stringify(datos),user.id,String(user.nombre || user.usuario || 'Carburación').slice(0,160)]);
    await connection.commit();return id;
  }catch(error){await connection.rollback();if(error.code==='ER_DUP_ENTRY')throw fallo('Ya existe un cliente con ese nombre. Abra su ficha para editarlo.',409);throw error;}finally{connection.release();}
}
module.exports={CAMPOS_CLIENTE,validarFicha,puedeEditarClientes,guardarFicha};
