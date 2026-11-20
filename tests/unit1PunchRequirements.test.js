const test = require('node:test');
const assert = require('node:assert/strict');
const {parsePunchRequirements, groupPunchRequirements} = require('../services/unit1PunchRequirements');

test('physical requirements retain every absolute position and round-trip existing records', () => {
  const lines = [{punchSize:'9*20',profile:'l_flange',dimensions:'56-187-259-398-448'}, {punchSize:'9X20',profile:'web',dimensions:'0-500'}];
  const holes = parsePunchRequirements(lines, 500);
  assert.deepEqual(holes.map(hole => hole.targetMm), [56,187,259,398,448,0,500]);
  const original = JSON.stringify(holes);
  const groups = groupPunchRequirements({holes});
  assert.equal(groups[0].requirement, '9*20 - L flange - 56-187-259-398-448 mm');
  assert.deepEqual(parsePunchRequirements(groups,500), holes);
  assert.equal(JSON.stringify(holes),original);
});

test('invalid or excessive absolute positions are rejected without converting negative values', () => {
  for(const dimensions of ['-56','56--187','501','abc', '']) {
    assert.throws(() => parsePunchRequirements([{punchSize:'9*20',profile:'web',dimensions}],500));
  }
  assert.throws(() => parsePunchRequirements([{punchSize:'9*20',profile:'web',dimensions:Array(101).fill('1').join('-')}],500));
});
