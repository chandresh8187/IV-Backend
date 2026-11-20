const test = require('node:test');
const assert = require('node:assert/strict');
const { validateInvoiceEdit } = require('../services/unit1EditInward');
const line = id => ({id,materialType:'MS',grade:'E350',widthMm:254,thicknessMm:3,coilQty:2,totalWeightKg:2000,ratePerKg:65});
const inward = () => ({invoice:'Invoice',invoiceDate:'2026-10-20',vendorCode:'Vendor',tcNumber:'TC',batchIds:[1,2],lines:[line(1),line(2)]});
test('all sizes receive one shared receipt and retain their batch references', () => {
  const result = validateInvoiceEdit(inward());
  assert.deepEqual(result.batchIds,[1,2]);
  for (const entry of result.lines) { assert.equal(entry.value.invoice,'Invoice'); assert.equal(entry.value.tcNumber,'TC'); }
});
test('missing, duplicated and foreign sizes cannot silently become a partial edit', () => {
  for (const lines of [[line(1)],[line(1),line(1)],[line(1),line(3)]]) assert.throws(()=>validateInvoiceEdit({...inward(),lines}),{status:400});
  assert.throws(()=>validateInvoiceEdit({...inward(),lines:[line(1),{...line(2),totalWeightKg:0}]}),/Line 2/);
});
test('additional sizes are validated without changing existing identities', () => {
  const result = validateInvoiceEdit({...inward(),lines:[line(1),line(2),line(undefined)]});
  assert.equal(result.lines[2].id,null);
  assert.throws(()=>validateInvoiceEdit({...inward(),lines:[line(1),line(2),{...line(undefined),ratePerKg:null}]}),/rate per kg/);
});
test('editing inward keeps individual TC numbers on each coil line', () => {
  const result = validateInvoiceEdit({ ...inward(), lines: [{ ...line(1), tcNumber: 'TC-1' }, { ...line(2), tcNumber: 'TC-2' }] });
  assert.deepEqual(result.lines.map(entry => entry.value.tcNumber), ['TC-1', 'TC-2']);
});
