const test = require('node:test'), assert = require('node:assert/strict');
const { coilCode, assignCoilCode } = require('../services/unit1CoilCode');
test('coil codes are exactly six digits and range exhaustion is explicit', () => {
  assert.equal(coilCode(1),'100001'); assert.equal(coilCode(899999),'999999');
  for (const id of [0,-1,900000,NaN,1.5]) assert.throws(()=>coilCode(id));
});
test('allocation skips reserved legacy aliases and retries unique-index collisions', async () => {
  const calls=[];let attempt=0;
  const db={execute:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT'))return [args[0]==='100007'?[{id:22}]:[]];if(attempt++===0)throw Object.assign(Error('duplicate'),{code:'ER_DUP_ENTRY'});return [{}];}};
  assert.equal(await assignCoilCode(db,7),'100009');
  assert.equal(calls.at(-1).args[2],'100009');
});
test('migration preserves legacy QR references', async () => {
  const writes=[];const db={execute:async(sql,args)=>{if(sql.startsWith('SELECT'))return [[]];writes.push({sql,args});return [{}];}};
  assert.equal(await assignCoilCode(db,7,'U1-old-qr'),'100007');
  assert.doesNotMatch(writes[0].sql,/SET.*internal_id=/);
  assert.equal(await assignCoilCode(db,8,'123456'),'123456');
});
