const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDispatch, recordDispatch } = require('../services/unit1MaterialDispatch');
const { captureProduction } = require('../services/unit1MaterialStock');
const valid = { itemId: 1, quantity: '10', weighbridgeWeightKg:'75.5', destination: 'unit2', requestId: 'dispatch_test_request_12345' };
test('dispatch management has an explicit permission separate from stock viewing',()=>{
  const { getPermissionDefinition }=require('../services/permissionService');
  const permission=getPermissionDefinition('unit1.material-stock.dispatch');
  assert.deepEqual(permission.defaultRoles,['superadmin','production_manager','plant_manager']);
});

test('dispatch validates integer nos, known destinations and a stable retry key', () => {
  assert.equal(normalizeDispatch(valid).quantity,10);
  for(const quantity of [0,-1,1.5,'1e2','1000001','',null]) assert.throws(()=>normalizeDispatch({...valid,quantity}),{status:400});
  for(const body of [{destination:'unit3'},{itemId:'bad'},{requestId:'short'},{note:'x'.repeat(256)},{weighbridgeWeightKg:null},{weighbridgeWeightKg:'-1'},{weighbridgeWeightKg:'0'},{weighbridgeWeightKg:'1.2345'},{finishCoils:'yes'}]) assert.throws(()=>normalizeDispatch({...valid,...body}),{status:400});
});
function fixture(prior = null) {
  const allocations=[],inserts=[];
  const c={execute:async(sql,params)=>{
    if(sql.startsWith('SELECT id FROM unit1_coil_weight_lock'))return [[{id:1}]];
    if(sql.startsWith('SELECT * FROM unit1_material_stock_items')) {assert.match(sql,/FOR UPDATE/);return [[{id:1,customer_name:'Test',member_name:'Column'}]];}
    if(sql.startsWith('SELECT * FROM unit1_material_dispatches'))return [[prior].filter(Boolean)];
    if(sql.startsWith('SELECT COUNT(*) AS count FROM unit1_material_packed_bundles'))return [[{count:0}]];
    if(sql.startsWith('SELECT m.id'))return [[{id:4,quantity:40},{id:5,quantity:24}]];
    if(sql.startsWith('SELECT a.source_movement_id'))return [[{movementId:4,quantity:35}]];
    if(sql.startsWith('INSERT INTO unit1_material_dispatches')){inserts.push(params);return [{insertId:9}];}
    if(sql.startsWith('INSERT INTO unit1_material_dispatch_allocations')){allocations.push(params);return [{affectedRows:1}];}
    throw Error('Unexpected query: '+sql);
  }};
  return {c,allocations,inserts};
}
test('dispatch allocates only available production, oldest first, and keeps original party snapshot',async()=>{
  const f=fixture();
  await recordDispatch(f.c,valid,3);
  assert.deepEqual(f.allocations,[[9,4,5],[9,5,5]]);
  assert.equal(JSON.parse(f.inserts[0][6]).customer_name,'Test');
  const over=fixture();await assert.rejects(recordDispatch(over.c,{...valid,quantity:30},3),{status:409});
  assert.equal(over.inserts.length,0);
});
test('retry returns the same dispatch and rejects changed quantity, destination, item or actor',async()=>{
  const prior={id:9,item_id:1,quantity:10,destination:'unit2',note:null,actor_user_id:3,weighbridge_weight_kg:'75.500',finish_requested:0};
  const f=fixture(prior);assert.equal((await recordDispatch(f.c,valid,3)).id,9);assert.equal(f.inserts.length,0);
  for(const body of [{...valid,quantity:11},{...valid,destination:'other'},{...valid,itemId:2}]) await assert.rejects(recordDispatch(f.c,body,3),{status:409});
  await assert.rejects(recordDispatch(f.c,valid,4),{status:409});
});
test('stock correction audits old classifications and includes the effective job customer',async()=>{
  const queries=[];await captureProduction({execute:async(sql,args)=>{queries.push({sql,args});return [[]];}},null,7,true);
  assert.match(queries[0].sql,/customer_name/);
  assert.match(queries[0].sql,/\$\.customerName/);
  assert.match(queries[1].sql,/unit1_material_stock_revisions/);
  assert.match(queries[2].sql,/item_id=VALUES\(item_id\)/);
});
