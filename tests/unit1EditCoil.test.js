const test = require('node:test');
const assert = require('node:assert/strict');
const { editCoil } = require('../services/unit1EditCoil');
const { validateInward } = require('../services/unit1CoilValidation');

const original = { id:3,internal_id:'legacy-qr',public_code:'100003',supplier_coil_id:'supplier-ref',material_type:'MS',grade:'E350',width_mm:254,thickness_mm:3,rate_per_kg:50 };
const body = { invoice:'INV',invoiceDate:'2026-10-20',vendorCode:'Vendor',materialType:'MS',grade:'E350',widthMm:254,thicknessMm:3,coilQty:2,totalWeightKg:2000,ratePerKg:65 };
function fixture({ missing = false, runs = [], others = [] } = {}) {
  const calls = [];
  const connection = { execute: async (sql,params) => {
    calls.push({sql,params});
    if (sql.startsWith('SELECT id,job_card_id')) return [runs];
    if (sql.startsWith('SELECT * FROM coils')) return [missing ? [] : [original]];
    if (sql.includes('FROM unit1_job_cards WHERE')) return [[{ id:7,memberName:'Column',cutLengthMm:2300,materialType:'MS',coilWidthMm:254,coilThicknessMm:3,holes:[] }]];
    if (sql.startsWith('SELECT c.id,c.material_type')) return [others];
    if (sql.startsWith('INSERT INTO unit1_job_card_revisions')) return [{insertId:9}];
    return [[]];
  } };
  return {calls, save:(changes = {}, rateProvided = true) => editCoil(connection,3,validateInward({...body,...changes}).value,1,rateProvided)};
}
test('inward saves every editable field, records before values, and preserves both coil identifiers', async () => {
  const fixtureData = fixture(); await fixtureData.save();
  const update = fixtureData.calls.find(call => call.sql.startsWith('UPDATE coils SET'));
  assert.ok(update.params.includes('INV')); assert.ok(update.params.includes(65));
  assert.doesNotMatch(update.sql,/internal_id|public_code|supplier_coil_id|qr_generated_at/);
  const audit = fixtureData.calls.find(call => call.sql.startsWith('INSERT INTO unit1_coil_revisions'));
  assert.equal(JSON.parse(audit.params[2]).coil.internal_id,'legacy-qr');
  assert.equal(JSON.parse(audit.params[3]).coil.internal_id,'legacy-qr');
  assert.equal(JSON.parse(audit.params[3]).coil.rate_per_kg,65);
});
test('missing entries and removing used numbered coils reject before changing the inward', async () => {
  await assert.rejects(fixture({missing:true}).save(), {status:404});
  const fixtureData = fixture({runs:[{id:1,coilNumber:2,status:'returned'}]});
  await assert.rejects(fixtureData.save({coilQty:1}), /physical coil number/);
  assert.ok(!fixtureData.calls.some(call => call.sql.startsWith('UPDATE coils')));
});
test('omitted rate preserves its previous value', async () => {
  const fixtureData = fixture(); await fixtureData.save({},false);
  const update = fixtureData.calls.find(call => call.sql.startsWith('UPDATE coils SET'));
  assert.equal(update.params.at(-2),50);
});
test('specification corrections refresh linked job plans and require first-piece inspection again', async () => {
  const fixtureData = fixture({runs:[{id:1,jobCardId:7,coilNumber:2,status:'running'}]});
  await fixtureData.save({widthMm:300});
  assert.ok(fixtureData.calls.some(call => call.sql.startsWith('UPDATE unit1_job_cards SET material_type')));
  assert.ok(fixtureData.calls.some(call => call.sql.includes("status='setup'") && call.sql.includes('hole_checked_at=NULL')));
  assert.ok(fixtureData.calls.some(call => call.sql.startsWith('INSERT INTO unit1_job_card_revisions')));
  assert.ok(fixtureData.calls.some(call => call.sql.includes('JSON_SET(hc.report_snapshot')));
});
test('rate-only corrections retain approval, while incompatible active coils prevent plan changes', async () => {
  const runs = [{id:1,jobCardId:7,coilNumber:2,status:'running'}];
  const fixtureData = fixture({runs}); await fixtureData.save();
  assert.ok(!fixtureData.calls.some(call => call.sql.startsWith('UPDATE unit1_production_runs')));
  await fixture({runs,others:[{material_type:'MS',width_mm:254,thickness_mm:3}]}).save({widthMm:300});
  await assert.rejects(fixture({runs,others:[{material_type:'GL',width_mm:254,thickness_mm:3}]}).save({widthMm:300}), /different material/);
});
