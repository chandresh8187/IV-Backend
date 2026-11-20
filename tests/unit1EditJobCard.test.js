const test = require('node:test'), assert = require('node:assert/strict');
const { editJobCard } = require('../services/unit1EditJobCard');
const { historicalJobSql, jobSpecificationChanged } = require('../services/unit1JobHistory');

const original = { id: 7, jobDate: '2026-10-19', customerName: 'Old customer', projectNameCapacity: 'Project', productionQty: 100, structureType: 'solar_mounting_structure', memberName: 'Column', sectionSize: '150x65x20', shift: 'day', cutLengthMm: 2300, plannedMachineId: 1, machineId: 1, materialType: 'MS', coilWidthMm: 254, coilThicknessMm: 3, punchSize: '12x20', status: 'open' };
const oldHoles = [{ id: 11, punchSize: '12x20', profile: 'web', targetMm: 100 }];
const value = changes => ({ ...original, holes: oldHoles.map((hole, i) => ({ ...hole, sequenceNo: i + 1 })), ...changes });
function fixture(runs = [{ id: 5, status: 'running', machineId: 1, coilId: 3, producedPieces: 20 }]) {
  const calls = [];
  const connection = { execute: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM unit1_job_cards WHERE id=? FOR UPDATE')) return [[original]];
    if (sql.startsWith('SELECT id,status,machine_id')) return [runs];
    if (sql.startsWith('SELECT id,punch_size')) return [oldHoles];
    if (sql.startsWith('SELECT material_type')) return [[{ materialType: 'MS', widthMm: 254, thicknessMm: 3 }]];
    if (sql.startsWith('SELECT COALESCE(MAX(sequence_no)')) return [[{ sequenceNo: 3 }]];
    if (sql.startsWith('SELECT hc.id')) return [[]];
    return [[]];
  } };
  return { calls, save: body => editJobCard(connection, 7, body, 1) };
}
test('all specifications save after production and an active run needs fresh first-piece approval', async () => {
  const f = fixture();
  await f.save(value({ memberName: 'Revised column', sectionSize: '160x65x20', cutLengthMm: 2500, shift: 'night', holes: [{ sequenceNo: 1, punchSize: '12x20', profile: 'web', targetMm: 200 }] }));
  const jobUpdate = f.calls.find(call => call.sql.startsWith('UPDATE unit1_job_cards'));
  assert.ok(jobUpdate.params.includes('Revised column'));
  assert.ok(jobUpdate.params.includes(2500));
  assert.ok(f.calls.some(call => call.sql.includes('SET b.job_snapshot=?')));
  assert.ok(f.calls.some(call => call.sql.includes('sequence_no=sequence_no+?,is_active=0')));
  assert.ok(!f.calls.some(call => call.sql.startsWith('DELETE')));
  const reset = f.calls.find(call => call.sql.startsWith('UPDATE unit1_production_runs'));
  assert.match(reset.sql, /status='setup'/);
  assert.match(reset.sql, /hole_checked_at=NULL/);
  assert.match(reset.sql, /TIMESTAMPDIFF/);
});
test('order-only changes keep active approval and existing hole IDs', async () => {
  const f = fixture(); await f.save(value({ customerName: 'New customer', productionQty: 200 }));
  assert.ok(!f.calls.some(call => call.sql.startsWith('UPDATE unit1_production_runs')));
  assert.ok(!f.calls.some(call => call.sql.includes('is_active=0')));
});
test('physical coil/machine changes and impossible targets reject before writing', async () => {
  for (const changes of [{ plannedMachineId: 2 }, { materialType: 'GL' }, { productionQty: 19 }]) {
    const f = fixture(); await assert.rejects(f.save(value(changes)), { status: 409 });
    assert.ok(!f.calls.some(call => call.sql.startsWith('UPDATE')));
  }
});
test('after returning the coil all plan fields can change and previous machine assignment is cleared', async () => {
  const f = fixture([{ id: 5, status: 'returned', machineId: 1, coilId: 3, producedPieces: 20 }]);
  await f.save(value({ plannedMachineId: 2, coilWidthMm: 300, materialType: 'GL' }));
  const update = f.calls.find(call => call.sql.startsWith('UPDATE unit1_job_cards'));
  assert.equal(update.params.at(-2), null);
});
test('historical SQL uses frozen job fields while current inspection fields stay independent', () => {
  const sql = historicalJobSql('SELECT j.member_name,j.cut_length_mm,j.id FROM bundle b JOIN job j');
  assert.match(sql, /JSON_EXTRACT\(b.job_snapshot,'\$.memberName'\)/);
  assert.match(sql, /j.id/);
  assert.equal(jobSpecificationChanged(original, value({}), oldHoles), false);
});

test('reference coil size edits do not require replacing an already allowed physical coil',async()=>{const f=fixture();await f.save(value({coilWidthMm:300}));assert.ok(f.calls.some(c=>c.sql.startsWith('UPDATE unit1_job_cards')));assert.ok(f.calls.some(c=>c.sql.includes("status='setup'")));});
