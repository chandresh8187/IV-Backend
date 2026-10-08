const test = require('node:test');
const assert = require('node:assert/strict');
const { MATERIALS, normalizeGrade } = require('../services/unit1MaterialGrades');

test('materials include the four production types', () => {
  assert.deepEqual(MATERIALS.map(item => item.key), ['MS', 'GL', 'GP', 'Posmac']);
});

test('grade changes reject GP list entries', () => {
  assert.equal(normalizeGrade('MS', ' E250 ').value, 'E250');
  assert.match(normalizeGrade('GP', '100').error, /not managed as a list/);
  assert.match(normalizeGrade('bad', 'E250').error, /material type/);
});
