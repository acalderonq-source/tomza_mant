const clave=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const GRUPOS_OPERATIVOS=['LA CRUZ','CEDIS ZONA SUR','CEDIS ATLÁNTICO','CEDIS SAN CARLOS','ADMINISTRATIVO'];
const EMPRESAS_BASE=['GAS TOMZA','SUPER GAS','TRANSPORTADORA DE CATALUÑA',...GRUPOS_OPERATIVOS];
const equivalencias=new Map();
for(const [empresa,variantes] of [
  ['GAS TOMZA',['GAS TOMZA','GAS TOMZA DE COSTA RICA S.A.','GAS TOMZA DE COSTA RICA SOCIEDAD ANONIMA','GAS TOMZA DE COSTA RICA S.A. DE C.V.']],
  ['SUPER GAS',['SUPER GAS','SUPERGAS','ENVASADORA SUPER GAS GLP S.A.','ENVASADORA SUPERGAS GLP S.A.','ENVASADORA SUPER GAS GLP SOCIEDAD ANONIMA','ENVASADORA SUPERGAS GLP SOCIEDAD ANONIMA','ENVASADORA SUPERGAS GLP S.A. DE C.V.','SUPERGAS DE COSTA RICA S.A.','SUPERGAS DE COSTA RICA SOCIEDAD ANONIMA']],
  ['TRANSPORTADORA DE CATALUÑA',['CATALUÑA','TRANSPORTADORA DE CATALUÑA','TRANSPORTADORA DE CATALUÑA S.A.','COMPAÑIA TRANSPORTADORA DE CATALUÑA S.A.']],
  ['LA CRUZ',['LA CRUZ','ORDINARIOS La Cruz']],
  ['CEDIS ZONA SUR',['CEDIS ZONA SUR','CEDIS SAN ISIDRO','ORDINARIOS San Isidro']],
  ['CEDIS ATLÁNTICO',['CEDIS ATLANTICO','ORDINARIOS Atlántico']],
  ['CEDIS SAN CARLOS',['CEDIS SAN CARLOS','ORDINARIOS San Carlos']],
  ['ADMINISTRATIVO',['ADMINISTRATIVO','ADMINISTRACIÓN','Ordinarios Administrativos']]
])for(const v of variantes)equivalencias.set(clave(v),empresa);
function normalizarEmpresa(v){
  const s=String(v||'').trim().replace(/\s+/g,' ').toUpperCase();
  // Granel identifica una unidad de negocio, no una razón social confirmada.
  if(!s||['GRANEL','NULL'].includes(s))return '';
  return equivalencias.get(clave(s))||s;
}
module.exports={EMPRESAS_BASE,GRUPOS_OPERATIVOS,normalizarEmpresa};
