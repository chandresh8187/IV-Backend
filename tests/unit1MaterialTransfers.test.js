const test=require('node:test'),assert=require('node:assert/strict');
const {projectOwnership,ownerKey}=require('../services/unit1MaterialOwnership');
const {validate}=require('../services/unit1MaterialTransfers');
const {summarize,materialKey,traceRows}=require('../services/unit1MaterialRegister');
const {allocate}=require('../services/unit1DispatchNotes');
const row={id:1,coilId:1,coilNumber:1,customerName:'AB',memberName:'PURLIN',sectionSize:'150X50X15',lengthMm:2300,materialType:'MS',grade:'E350',thicknessMm:2,producedNos:100,usedKg:500,holeScrapKg:10,cutBladeScrapKg:2,createdAt:'2026-11-20'};
const move=(fromOwner,toOwner,quantity,targetParty)=>({bundleId:1,fromOwner,toOwner,quantity,targetParty});
test('party transfer validates stock, uppercase party, whole quantity and retry identity',()=>{
 const valid={key:materialKey(row),targetParty:' ac ',quantity:'60',requestId:'transfer_test_request'};
 assert.equal(validate(valid).targetParty,'AC');
 for(const patch of [{key:''},{targetParty:''},{targetParty:'x'.repeat(161)},{quantity:0},{quantity:1.5},{quantity:1000001},{requestId:''}])assert.throws(()=>validate({...valid,...patch}),{status:400});
});
test('ownership merges existing parties without creating production or losing source coils and weights',()=>{
 const ac=ownerKey('AC'),transfers=[move('origin',ac,60,'AC')];
 const rows=projectOwnership([row,{...row,id:2,customerName:'AC',producedNos:25,usedKg:125}],transfers,[{id:1,ownerId:'origin',quantity:20}]);
 const summary=summarize(rows),ab=summary.find(r=>r.customerName==='AB'),target=summary.find(r=>r.customerName==='AC');
 assert.equal(ab.producedNos,100);assert.equal(ab.availableNos,20);assert.equal(ab.transferredOutNos,60);
 assert.equal(target.producedNos,25);assert.equal(target.availableNos,85);assert.equal(target.transferredInNos,60);
 assert.equal(summary.reduce((n,r)=>n+r.producedNos,0),125);assert.equal(rows.reduce((n,r)=>n+r.usedKg,0),625);
 assert.equal(traceRows(rows,target.key,[]).sourceCoils[0].producedNos,85);
 assert.deepEqual(traceRows(rows,target.key,[]).originalParties,['AB','AC']);
 const allocations=allocate(rows,[{key:target.key,quantity:70}])[0].allocations;
 assert.deepEqual(allocations,[{bundleId:1,quantity:60,ownerId:ac},{bundleId:2,quantity:10,ownerId:'origin'}]);
 assert.throws(()=>allocate(rows,[{key:ab.key,quantity:21}]),{status:409});
});
test('returns and retransfers keep ownership and dispatch commitments independent per physical bundle',()=>{
 const ac=ownerKey('AC'),ad=ownerKey('AD');
 const transfers=[move('origin',ac,60,'AC'),move(ac,'origin',10,'AB'),move(ac,ad,20,'AD')];
 const rows=projectOwnership([row],transfers,[{id:1,ownerId:ac,quantity:20}]);
 assert.equal(rows.find(r=>r.customerName==='AB').producedNos,50);
 assert.equal(rows.find(r=>r.customerName==='AC').producedNos,30);
 assert.equal(summarize(rows).reduce((n,r)=>n+r.availableNos,0),80);
 assert.throws(()=>projectOwnership([{...row,producedNos:40}],transfers,[{id:1,ownerId:'origin',quantity:1}]),{status:409});
 assert.throws(()=>projectOwnership([row],[move('origin',ac,101,'AC')],[]),{status:409});
 assert.throws(()=>projectOwnership([{...row,reservedNos:50}],[move('origin',ac,60,'AC')],[]),{status:409});
});
test('later planning party corrections can merge owner buckets without double allocating a physical bundle',()=>{
 const ac=ownerKey('AC'),rows=projectOwnership([{...row,customerName:'AC'}],[move('origin',ac,60,'AC')],[]);
 const [line]=allocate(rows,[{key:materialKey(rows[0]),quantity:100}]);
 assert.equal(line.allocations.length,2);assert.deepEqual(line.allocations.map(a=>a.quantity),[40,60]);
 assert.equal(summarize(rows)[0].availableNos,100);assert.equal(summarize(rows)[0].producedNos,100);
});
test('party transfer has its own User Access permission and superadmin bypass',async()=>{
 const {getUserAccess,hasPermission}=require('../services/permissionService'),key='unit1.material-stock.transfer';
 const catalogue=await getUserAccess({userId:1,role:'supervisor',scope:'unit1',queryable:{query:async()=>[[]]}});
 assert.equal(catalogue.permissions.find(p=>p.key===key).allowed,false);
 assert.equal(await hasPermission({userId:1,role:'supervisor',permissionKey:key,queryable:{query:async()=>[[{allowed:1}]]}}),true);
 assert.equal(await hasPermission({userId:1,role:'superadmin',permissionKey:key,queryable:{query(){throw Error('Superadmin must bypass');}}}),true);
});
