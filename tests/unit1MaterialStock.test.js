const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeOpening,recordOpening,captureProduction}=require('../services/unit1MaterialStock');
const valid={memberName:'Column',sectionSize:'150 x 75',lengthMm:'2300',materialType:'MS',grade:'E350',thicknessMm:'2',quantity:'500',requestId:'opening_test_request_12345'};
test('stock quantities are positive whole nos and geometry supports at most three decimals',()=>{
 assert.equal(normalizeOpening(valid).quantity,500);
 assert.equal(normalizeOpening(valid).note,'');
 for(const bad of ['1.5','0','-1','1e3','1000001',NaN])assert.throws(()=>normalizeOpening({...valid,quantity:bad}),{status:400});
 for(const bad of ['0','-2','1.2345','1e3'])assert.throws(()=>normalizeOpening({...valid,lengthMm:bad}),{status:400});
 for(const bad of [{memberName:''},{sectionSize:' '},{grade:''},{materialType:'other'},{requestId:'short'},{note:'x'.repeat(256)}])assert.throws(()=>normalizeOpening({...valid,...bad}),{status:400});
});
test('production capture is bundle-scoped and backfill excludes already captured bundles',async()=>{
 const calls=[],db={execute:async(sql,params)=>{calls.push({sql,params});return []}};
 await captureProduction(db,19);
 assert.equal(calls.length,2);for(const call of calls){assert.match(call.sql,/WHERE b.id=\?/);assert.deepEqual(call.params,[19]);assert.match(call.sql,/ON DUPLICATE KEY UPDATE/)}
 calls.length=0;await captureProduction(db);
 for(const call of calls)assert.match(call.sql,/NOT EXISTS.*source_bundle_id=b.id/);
});
test('opening retry mismatch fails instead of silently applying a different payload',async()=>{
 let count=0;const db={execute:async()=>{count++;return count===2?[[{id:7}]]:count===4?[[{id:9,itemId:7,quantity:499,note:null,actorUserId:3}]]:[]}};
 await assert.rejects(recordOpening(db,valid,3),{status:409});
});
