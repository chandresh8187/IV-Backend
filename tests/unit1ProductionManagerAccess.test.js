const test = require('node:test');
const assert = require('node:assert/strict');
const { isDefaultAllowed } = require('../services/permissionService');

test('Unit 1 production manager can plan, assign and review production by default', () => {
  for (const key of [
    'unit1.jobcards.manage',
    'unit1.jobcards.assign',
    'unit1.jobcards.unassign',
    'unit1.production.coil.assign',
    'unit1.production.coil.remove',
    'unit1.production.view',
    'unit1.coils.view',
  ]) assert.equal(isDefaultAllowed('production_manager', key), true, key);
  assert.equal(isDefaultAllowed('production_manager', 'unit1.production.supervise'), false);
});

test('Unit 1 supervisor can scan coils, review job cards and check holes by default', () => {
  for (const key of [
    'unit1.coils.scan',
    'unit1.coils.view',
    'unit1.machines.view',
    'unit1.production.view',
    'unit1.production.coil.assign',
    'unit1.production.supervise',
    'unit1.jobcards.assign',
  ]) assert.equal(isDefaultAllowed('supervisor', key), true, key);
  assert.equal(isDefaultAllowed('supervisor', 'unit1.jobcards.manage'), false);
});

test('Production manager can assign Labour to machines without full user management', () => {
  assert.equal(isDefaultAllowed('production_manager', 'unit1.users.view'), true);
  assert.equal(isDefaultAllowed('production_manager', 'unit1.machines.view'), true);
  assert.equal(isDefaultAllowed('production_manager', 'unit1.users.labour.assign'), true);
  assert.equal(isDefaultAllowed('production_manager', 'unit1.users.manage'), false);
});

test('Labour defaults allow production entries without machine or coil controls', () => {
  for (const key of ['unit1.production.view', 'unit1.production.bundle']) assert.equal(isDefaultAllowed('labour', key), true, key);
  for (const key of ['unit1.production.operate', 'unit1.production.coil.assign', 'unit1.production.supervise', 'unit1.jobcards.assign', 'unit1.coils.scan', 'unit1.machines.view']) assert.equal(isDefaultAllowed('labour', key), false, key);
});
