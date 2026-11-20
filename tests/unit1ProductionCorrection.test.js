const test=require('node:test'),assert=require('node:assert/strict');
const {validateCorrection,correctedWeights}=require('../services/unit1ProductionCorrection');
const {getUserAccess,hasPermission}=require('../services/permissionService');
const access=require('../middleware/roleMiddleware');
const key='unit1.production.edit';
test('production correction validates actual quantities, reason and stable request identity',()=>{
 const valid={pieces:'64',expectedPieces:100,reason:' Corrected count ',requestKey:'correction_test_123'};
 assert.deepEqual(validateCorrection(valid),{pieces:64,expectedPieces:100,reason:'Corrected count',requestKey:'correction_test_123'});
 for(const pieces of [0,-1,1.2,100001,'bad'])assert.throws(()=>validateCorrection({...valid,pieces}),{status:400});
 for(const body of [{...valid,reason:''},{...valid,reason:'x'.repeat(256)},{...valid,requestKey:''},{...valid,expectedPieces:0}])assert.throws(()=>validateCorrection(body),{status:400});
});
test('quantity corrections retain the recorded weight basis and keep unknown scrap unknown',()=>{
 const bundle={pieces:100,theoretical_used_kg:500,hole_scrap_kg:10,cut_blade_scrap_kg:2};
 assert.deepEqual(correctedWeights(bundle,64),{theoretical_used_kg:320,hole_scrap_kg:6.4,cut_blade_scrap_kg:1.28});
 assert.deepEqual(correctedWeights({...bundle,hole_scrap_kg:null,cut_blade_scrap_kg:null},64),{theoretical_used_kg:320,hole_scrap_kg:null,cut_blade_scrap_kg:null});
});
test('edit is configurable in User Access and superadmin needs no permission or override query',async()=>{
 const denied={query:async()=>[[{allowed:0}]]};
 assert.equal(await hasPermission({userId:1,role:'superadmin',permissionKey:key,queryable:{query(){throw Error('Superadmin must bypass permission queries');}}}),true);
 for(const role of ['supervisor','plant_manager','production_manager','admin','labour']){
  assert.equal(await hasPermission({userId:1,role,permissionKey:key,queryable:denied}),false);
  assert.equal(await hasPermission({userId:1,role,permissionKey:key,queryable:{query:async()=>[[{allowed:1}]]}}),true);
 }
 const catalogue=await getUserAccess({userId:1,role:'supervisor',scope:'unit1',queryable:{query:async()=>[[]]}});
 const permission=catalogue.permissions.find(item=>item.key===key);assert.equal(permission.label,'Edit production entries');assert.equal(permission.allowed,false);
});
test('API denies production edits without the edit permission and lets superadmin pass',async()=>{
 for(const role of ['supervisor','superadmin']){
  const req={user:{id:1,role},authDb:{query:async()=>[[]]}};
  const res={status(value){this.code=value;return this;},json(value){this.body=value;}};let passed=false;
  await access([],key)(req,res,()=>{passed=true;});
  assert.equal(passed,role==='superadmin');if(role==='supervisor')assert.equal(res.code,403);
 }
});
