const test = require('node:test');
const assert = require('node:assert/strict');
const { coilMatchesJob } = require('../services/unit1CoilMatch');
const { isDefaultAllowed } = require('../services/permissionService');

test('only the planned material, width and thickness match a scanned coil', () => {
  const job = { materialType: 'MS', coilWidthMm: 178, coilThicknessMm: 2 };
  assert.equal(coilMatchesJob({ materialType: 'MS', widthMm: 178, thicknessMm: 2 }, job), true);
  assert.equal(coilMatchesJob({ materialType: 'MS', widthMm: 180, thicknessMm: 2 }, job), false);
  assert.equal(coilMatchesJob({ materialType: 'MS', widthMm: 178, thicknessMm: 2.5 }, job), false);
  assert.equal(coilMatchesJob({ materialType: 'GL', widthMm: 178, thicknessMm: 2 }, job), false);
});

test('production managers can assign and unassign job cards and coils', () => {
  assert.equal(isDefaultAllowed('production_manager', 'unit1.jobcards.manage'), true);
  assert.equal(isDefaultAllowed('production_manager', 'unit1.jobcards.assign'), true);
  assert.equal(isDefaultAllowed('production_manager', 'unit1.jobcards.unassign'), true);
  assert.equal(isDefaultAllowed('production_manager', 'unit1.coils.scan'), true);
  assert.equal(isDefaultAllowed('production_manager', 'unit1.production.coil.assign'), true);
  assert.equal(isDefaultAllowed('production_manager', 'unit1.production.coil.remove'), true);
  assert.equal(isDefaultAllowed('production_manager', 'unit1.production.supervise'), false);
  assert.equal(isDefaultAllowed('supervisor', 'unit1.jobcards.assign'), false);
  assert.equal(isDefaultAllowed('supervisor', 'unit1.production.coil.assign'), true);
  assert.equal(isDefaultAllowed('supervisor', 'unit1.production.supervise'), true);
  assert.equal(isDefaultAllowed('labour', 'unit1.production.bundle'), false);
});

test('selected coils may vary in width and thickness while retaining job material',()=>{const job={materialType:'MS',coilWidthMm:258,coilThicknessMm:3};assert.equal(coilMatchesJob({materialType:'MS',widthMm:256,thicknessMm:2.8},job,{allowSizeVariation:true}),true);assert.equal(coilMatchesJob({materialType:'GL',widthMm:256,thicknessMm:2.8},job,{allowSizeVariation:true}),false);});
