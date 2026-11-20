const test=require('node:test'),assert=require('node:assert/strict');
const {removeSetupCoil}=require('../services/unit1RemoveSetupCoil');
test('releasing a corrected setup coil retains its quantities, inspections and existing events',async()=>{
 const calls=[],db={execute:async(sql,args)=>{calls.push({sql,args});return sql.startsWith('SELECT')?[[{status:'setup',jobCardId:7}]]:[{}];}};
 assert.deepEqual(await removeSetupCoil(db,3,9),{removed:true,historyRetained:true});
 assert.equal(calls.length,3);assert(calls.some(c=>c.sql.includes("status='returned'")));assert(calls.some(c=>c.sql.startsWith('INSERT INTO unit1_production_events')));
 assert(!calls.some(c=>/DELETE|produced_pieces\s*=|pieces\s*=|report_snapshot\s*=/.test(c.sql)));
});
test('removal cannot release running, paused, finished or missing runs',async()=>{
 for(const row of [null,{status:'running',jobCardId:1},{status:'paused',jobCardId:1},{status:'completed',jobCardId:1},{status:'setup',jobCardId:null}]){
  const calls=[],db={execute:async sql=>{calls.push(sql);return [row?[row]:[]];}};await assert.rejects(removeSetupCoil(db,1,9));assert.equal(calls.length,1);
 }
});
