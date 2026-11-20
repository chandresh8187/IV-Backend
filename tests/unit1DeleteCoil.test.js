const test = require('node:test');
const assert = require('node:assert/strict');
const { deleteCoil } = require('../services/unit1DeleteCoil');

function fixture({ missing=false, used=0, planned=false, produced=0, active=0 }={}) {
  const writes=[];
  const coil={ id:7, actual_net_kg:'1000', invoice:'INV-1' };
  const identifiers=[{code:'ABC1234567',batch_id:7}];
  const connection={execute:async(sql,args)=>{
    if(sql.startsWith('SELECT * FROM coils')) return [missing?[]:[coil]];
    if(sql.includes('COUNT(*)')) return [[{usedQty:used,producedPieces:produced,activeAssignments:active}]];
    if(sql.includes('SELECT job_card_id')) return [planned?[{job_card_id:3}]:[]];
    if(sql.includes('SELECT * FROM unit1_coil_identifiers')) return [identifiers];
    writes.push({sql,args});return [{affectedRows:1}];
  }};
  return {connection,writes,coil,identifiers};
}
test('unused inward preserves original inputs and QR identifiers in audit before deletion',async()=>{
  const f=fixture();await deleteCoil(f.connection,7,2);
  assert.equal(f.writes.length,2);
  assert.match(f.writes[0].sql,/INSERT INTO unit1_coil_revisions/);
  assert.deepEqual(JSON.parse(f.writes[0].args[2]),{coil:f.coil,identifiers:f.identifiers});
  assert.deepEqual(JSON.parse(f.writes[0].args[3]),{deleted:true});
  assert.match(f.writes[1].sql,/DELETE FROM coils/);
});
for(const [name,options,status] of [['missing',{missing:true},404],['production history',{used:'1'},409],['planning selection',{planned:true},409]]) {
  test(`protects ${name} without changing stock or history`,async()=>{
    const f=fixture(options);await assert.rejects(deleteCoil(f.connection,7,2),{status});assert.equal(f.writes.length,0);
  });
}
test('audit write failure prevents deleting the inward',async()=>{
  const f=fixture();const execute=f.connection.execute;
  f.connection.execute=async(sql,args)=>{if(sql.startsWith('INSERT'))throw new Error('audit unavailable');return execute(sql,args);};
  await assert.rejects(deleteCoil(f.connection,7,2),/audit unavailable/);assert.equal(f.writes.length,0);
});
test('explains setup assignments separately from recorded production',async()=>{
  const setup=fixture({used:1,active:1});
  await assert.rejects(deleteCoil(setup.connection,7,2),/Remove its setup assignment/);
  const produced=fixture({used:1,produced:64});
  await assert.rejects(deleteCoil(produced.connection,7,2),/recorded production/);
  assert.equal(setup.writes.length+produced.writes.length,0);
});
