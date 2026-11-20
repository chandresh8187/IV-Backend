const test=require('node:test'),assert=require('node:assert/strict');
const {parseQr,materialDetails,coilDetails,roleFields}=require('../services/unit1QrScanner');
const {normalizeFields,parseFields,DEFAULT_FIELDS}=require('../services/unit1CoilQr');
const key='a'.repeat(64);
test('universal scanner recognizes current material, invoice and legacy coil QR without opening URLs',()=>{
 assert.deepEqual(parseQr(JSON.stringify({type:'unit1-material-stock',version:1,key})),{type:'material',key});
 assert.deepEqual(parseQr('ivs1:///scan/coil/CQ00000029/1'),{type:'coil',reference:'CQ00000029',number:1});
 assert.deepEqual(parseQr('https://webapp.ivsquarestructure.com/unit1/scan/coil/U1-A%20B%2F7/3'),{type:'coil',reference:'U1-A B/7',number:3});
 assert.deepEqual(parseQr('CQ00000029'),{type:'coil',reference:'CQ00000029'});
 for(const value of ['',null,'https://example.com','javascript:alert(1)','x'.repeat(2049),'ivs1:///scan/coil/A/0','ivs1:///scan/coil/%E0/1',JSON.stringify({type:'unit1-material-stock',version:2,key})])assert.throws(()=>parseQr(value),{status:400});
});
test('QR settings preserve coil selections while adding explicit material and party switches',async()=>{
 const fields=['invoice','material.customerName','material.availableNos','material.bundles'];assert.deepEqual(normalizeFields(fields),fields);assert.equal(normalizeFields(['arbitrary']),null);assert.deepEqual(parseFields(JSON.stringify(DEFAULT_FIELDS)),DEFAULT_FIELDS);
 assert.deepEqual(await roleFields({execute:async()=>[[{fields:'[]'}]]},'supervisor'),[]);
 assert.deepEqual(await roleFields({execute:async()=>[[{fields:JSON.stringify(fields)}]]},'supervisor'),fields);
});
test('material QR responses contain only allowed fields, source details, bundles and weights',()=>{
 const trace={stock:{key,customerName:'PRIVATE PARTY',memberName:'PURLIN',availableNos:80,producedNos:100,grade:'E350'},originalParties:['ORIGINAL PARTY'],sourceCoils:[{reference:'CQ00000029',producedNos:100,usedKg:500,holeScrapKg:10,cutBladeScrapKg:2,fields:[{key:'invoice',value:'SECRET INVOICE'},{key:'ratePerKg',value:60},{key:'grade',value:'E350'}]}]},bundles={bundles:[{bundleNo:1,runId:9,id:3,quantity:100,dispatchedNos:20,availableNos:80,createdAt:'2026-11-20'}]};
 const limited=materialDetails(trace,bundles,['material.memberName','material.availableNos']);
 assert.deepEqual(limited.fields.map(f=>f.value),['PURLIN',80]);assert.equal(Object.hasOwn(limited,'stock'),false);assert.equal(Object.hasOwn(limited,'sourceCoils'),false);assert.equal(Object.hasOwn(limited,'bundles'),false);assert.doesNotMatch(JSON.stringify(limited),/PRIVATE|ORIGINAL|SECRET|500/);
 const source=materialDetails(trace,bundles,['material.sourceCoils','grade']);assert.deepEqual(source.sourceCoils,[{reference:'CQ00000029',fields:[{key:'grade',value:'E350'}]}]);
 const weightsOnly=materialDetails(trace,bundles,['material.coilUsage','invoice']);assert.equal(weightsOnly.sourceCoils[0].usedKg,500);assert.equal(Object.hasOwn(weightsOnly.sourceCoils[0],'reference'),false);assert.deepEqual(weightsOnly.sourceCoils[0].fields,[]);
 const full=materialDetails(trace,bundles,['material.customerName','material.sourceCoils','material.coilUsage','material.bundles','invoice']);assert.equal(full.fields[0].value,'PRIVATE PARTY');assert.equal(full.sourceCoils[0].usedKg,500);assert.equal(full.bundles[0].quantity,100);assert.equal(Object.hasOwn(full.bundles[0],'runId'),false);assert.equal(Object.hasOwn(full.bundles[0],'id'),false);
 assert.deepEqual(materialDetails(trace,bundles,[]),{type:'material',reference:key,fields:[]});
});
test('coil results never return assignment proofs, database IDs or unfiltered stock metadata',()=>{
 assert.deepEqual(coilDetails({reference:'CQ00000029',stockQrId:1,scanProof:'SECRET',coilId:3,invoice:'PRIVATE',fields:[{key:'grade',label:'Grade',value:'E350'},{key:'unexpected',value:'SECRET'}]}),{type:'coil',reference:'CQ00000029',fields:[{key:'grade',label:'Grade',value:'E350'}]});
});
test('scan feature permissions still reject users without the corresponding read access',async()=>{
 const access=require('../middleware/roleMiddleware');
 for(const permission of ['unit1.coils.scan','unit1.material-stock.view']){
  let passed=false;const response={status(code){this.code=code;return this;},json(){}};
  await access([],permission)({user:{id:1,role:'supervisor'},authDb:{query:async()=>[[{allowed:0}]]}},response,()=>{passed=true;});
  assert.equal(passed,false);assert.equal(response.code,403);
 }
});
