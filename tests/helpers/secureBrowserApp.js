const ejs=require('ejs');
const {configurarVistasSeguras,finalizarHtmlSeguro}=require('../../src/utils/vistasSeguras');
module.exports=app=>{
 configurarVistasSeguras(ejs);
 app.use((_req,res,next)=>{
  const render=res.render.bind(res);
  res.render=(view,options)=>render(view,options,(err,html)=>err?next(err):res.send(finalizarHtmlSeguro(html,res.locals.cspNonce)));
  next();
 });
};
