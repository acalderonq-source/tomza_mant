const test=require('node:test');
const assert=require('node:assert/strict');
const {organizar,plan}=require('../src/scripts/organizarIndicesTaller');
function fake(existentes=false){const sql=[];return {sql,getConnection:async()=>({release(){},async query(q,p){sql.push(q);if(q.startsWith('SHOW CREATE'))return [[{'Create Table':'CREATE TABLE demo (id INT)'}]];if(q.includes('information_schema.STATISTICS'))return [existentes?plan.find(i=>i.indice===p[1]).columnas.map(columna=>({columna})):[]];if(q.startsWith('SELECT checksum'))return [[]];return [{}];}})};}
test('simulacion no aplica DDL ni registra migraciones',async()=>{const db=fake();const r=await organizar(db);assert.equal(r.length,3);assert.ok(!db.sql.some(s=>/^(ALTER|INSERT)/.test(s)));});
test('aplicar guarda estructura antes de indices y no bloquea escrituras',async()=>{const db=fake();let respaldo=false;await organizar(db,true,async r=>{assert.equal(r.length,3);assert.ok(!db.sql.some(s=>s.startsWith('ALTER')));respaldo=true;});assert.ok(respaldo);assert.equal(db.sql.filter(s=>s.startsWith('ALTER')).length,3);assert.ok(db.sql.filter(s=>s.startsWith('ALTER')).every(s=>s.includes('LOCK=NONE')));});
test('indices ya existentes no se recrean',async()=>{const db=fake(true);await organizar(db,true,async()=>{});assert.ok(!db.sql.some(s=>s.startsWith('ALTER')));});
