const router=require('express').Router();
const pool=require('../db');
const {prepararPlanilla,sincronizarPersonas}=require('../utils/planillaContabilidad');
const {prepararArchivos}=require('../utils/presupuestoCargaCompleta');
const {normalizarEmpresa}=require('../utils/empresasContabilidad');
const {periodoValido,MONEDAS,exigir}=require('../utils/presupuestosContabilidad');
const {fechaActualCostaRica}=require('../utils/fechaCostaRica');
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
router.use((req,res,next)=>{
 if(!req.session?.user)return res.redirect('/login');
 if(req.session.user.rol!=='ADMIN')return res.status(403).send('Planilla disponible solo para Administración.');
 res.set('Cache-Control','no-store');next();
});
router.get('/',wrap(async(req,res)=>{
 await prepararArchivos(pool);await prepararPlanilla(pool);
 const [meses]=await pool.query('SELECT DISTINCT periodo FROM cont_planilla_personas UNION SELECT DISTINCT periodo FROM cont_presupuesto_archivos ORDER BY periodo DESC');
 const periodo=String(req.query.periodo||meses[0]?.periodo||fechaActualCostaRica().slice(0,7));
 const empresa=normalizarEmpresa(req.query.empresa),buscar=String(req.query.buscar||'').trim(),moneda=String(req.query.moneda||'');
 exigir(periodoValido(periodo)&&empresa.length<=120&&buscar.length<=180&&(!moneda||MONEDAS.includes(moneda)),'Revise los filtros de planilla.');
 await sincronizarPersonas(pool,periodo);
 const [filas]=await pool.query(`SELECT p.*,r.salario FROM cont_planilla_personas p LEFT JOIN cont_planilla_registros r ON r.persona_id=p.id WHERE p.periodo=? ORDER BY p.empresa,p.nombre,p.id`,[periodo]);
 const empresas=[...new Set(filas.map(p=>p.empresa))];
 const lista=filas.filter(p=>(!empresa||p.empresa===empresa)&&(!moneda||p.moneda===moneda)&&(!buscar||`${p.nombre} ${p.empresa} ${p.puesto}`.toLocaleLowerCase('es').includes(buscar.toLocaleLowerCase('es'))));
 const paginas=Math.max(1,Math.ceil(lista.length/50)),pagina=Math.max(1,Math.min(paginas,Number.parseInt(req.query.pagina,10)||1));
 const resumen={cantidad:lista.length,empresas:new Set(lista.map(p=>p.empresa)).size,registrados:lista.filter(p=>p.salario!=null).length,pendientes:lista.filter(p=>p.salario==null).length};
 res.render('contabilidad/nomina',{user:req.session.user,personas:lista.slice((pagina-1)*50,pagina*50),pagina,paginas,resumen,empresas,periodos:[...new Set([periodo,...meses.map(m=>m.periodo)])].sort().reverse(),f:{periodo,empresa,buscar,moneda}});
}));
router.use((err,req,res,_next)=>{console.error('Planilla:',err.code||err.message);res.status(err.status||500).render('contabilidad/error',{mensaje:err.status?err.message:'No se pudo consultar la planilla. Vuelva a intentar.'});});
module.exports=router;
