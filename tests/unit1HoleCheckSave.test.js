const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const { createRequire } = require('node:module');
const source = path.join(__dirname, '../routes/unit1ProductionRoutes.js'), localRequire = createRequire(source);
function fixture({maintenance=false, holes=[{ id: 5, punchSize: '12x20', profile: 'web', targetMm: 100 }]}={}) {
  const routes = {}, stored = [], calls = { commits: 0, rollbacks: 0 };
  const run = { id: 1, machineId: 1, jobCardId: 9, coilId:3,coilNumber:1,widthMm:254,thicknessMm:3,densityGcm3:7.85,status: 'setup', machineName: 'Line 1', coilQty: 1, coilBatchWeightKg: 1000, sectionSize: '150 x 65 x 20', cutLengthMm: 2300 };
  const execute = async (sql, args) => {
    if (sql.startsWith('SELECT id,invoice_group_id invoiceGroupId')) return [[{
      id: 3, weightRecorded: 1, widthMm: 254, thicknessMm: 3, materialType: 'GL', grade: 'G550',
    }]];
    if (sql.startsWith('SELECT id FROM coils WHERE width_mm=')) return [[{ id: 3 }]];
    if (sql.startsWith('SELECT c.id coilId,0 coilNumber,')) return [[{
      coilId: 3, weightRecorded: 1, totalWeightKg: 1000,
    }]];
    if (sql.includes('FROM unit1_maintenance_sessions')) return [maintenance?[{id:20}]:[]];
    if (sql.startsWith('SELECT machine_id AS machineId,status,')) return [[run]];
    if (sql.startsWith('SELECT machine_id AS machineId,job_card_id AS')) return [[run]];
    if (sql.includes('WHERE request_key=?')) return [stored.filter(row => row.key === args[0])];
    if (sql.startsWith('SELECT id,punch_size')) return [holes];
    if (sql.startsWith('SELECT name FROM users')) return [[{ name: 'Inspector' }]];
    if (sql.startsWith('INSERT INTO unit1_hole_checks')) { stored.push({ runId: args[0], checkedBy: args[2], snapshot: args[3], key: args[5] }); return [{ insertId: 11 }]; }
    if (sql.startsWith('UPDATE unit1_production_runs')) run.status = 'running';
    if (sql.startsWith('SELECT r.id')) return [[run]];
    return [[]];
  };
  const connection = { query:execute, execute, beginTransaction: async () => {}, commit: async () => calls.commits++, rollback: async () => calls.rollbacks++, release: () => {} };
  const router = { use: () => {}, get: (p, ...handlers) => { routes['GET '+p] = handlers.at(-1); }, post: (p, ...handlers) => { routes['POST '+p] = handlers.at(-1); } };
  const mocks = { express: { Router: () => router }, '../config/unit1Db': { execute, getConnection: async () => connection }, '../middleware/unit1AuthMiddleware': () => {}, '../middleware/roleMiddleware': () => (req, res, next) => next(), './unit1JobCardRoutes': {}, '../services/unit1Realtime': { publishUnit1Change: () => {} }, '../services/unit1ShiftService': { getSchedule: async () => ({}), currentShift: () => ({ name: 'day', shiftDate: '2026-10-18' }) } };
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), { require: name => mocks[name] || localRequire(name), module: { exports: {} } });
  const save = async body => { let error; const res = { status() { return this; }, json(value) { this.body = value; } }; await routes['POST /runs/:id/hole-check']({ params: { id: '1' }, body, user: { id: 7, role: 'supervisor' } }, res, value => { error = value; }); if (error) throw error; return res; };
  const control=async action=>{let error;const res={status(){return this;},json(value){this.body=value;return this;}};await routes['POST /runs/:id/:action']({params:{id:'1',action},body:{},user:{id:7,role:'plant_manager'}},res,e=>{error=e;});if(error)throw error;return res;};
  return { save, control, stored, calls, run };
}
test('a retry after first-piece approval returns success without duplicating the saved inspection', async () => {
  const f = fixture(), body = { approved: true, requestKey: 'hc_retry_12345', measurements: [{ holeId: 5, measuredMm: 100.1 }], remarks: 'Verified', measuredCutLengthMm: 2300.2, measuredSectionSize: '150.1 x 65 x 20' };
  await f.save(body); await f.save(body);
  assert.equal(f.stored.length, 1); assert.equal(f.calls.commits, 2);
  const snapshot = JSON.parse(f.stored[0].snapshot); assert.equal(snapshot.measurements[0].measuredMm, 100.1);
  assert.equal(snapshot.measuredCutLengthMm,2300.2); assert.equal(snapshot.measuredSectionSize,'150.1 x 65 x 20');
  await assert.rejects(f.save({ ...body, remarks: 'Changed' }), { status: 409 });
  assert.equal(f.calls.rollbacks, 1);
  await assert.rejects(f.save({...body,measuredCutLengthMm:2301}),{status:409});
});

test('first-piece approval requires both actual dimensions before any inspection or running status is written',async()=>{
  for(const dimensions of [{},{measuredCutLengthMm:2300},{measuredSectionSize:'150x65x20'},{measuredCutLengthMm:2300,measuredSectionSize:'150x65'}]) {
    const f=fixture();
    await assert.rejects(f.save({approved:true,measurements:[{holeId:5,measuredMm:100}],...dimensions}),{status:400});
    assert.equal(f.stored.length,0);assert.equal(f.run.status,'setup');assert.equal(f.calls.commits,0);
  }
});

test('subsequent hole rechecks can retain their hole-only workflow',async()=>{
  const f=fixture();f.run.status='running';
  await f.save({approved:true,measurements:[{holeId:5,measuredMm:100.1}]});
  assert.equal(f.stored.length,1);assert.equal(JSON.parse(f.stored[0].snapshot).measuredCutLengthMm,undefined);
});
test('missing or mismatched hole readings are rejected before saving an inspection', async () => {
  const f = fixture();
  await assert.rejects(f.save({ approved: true, measurements: [{ holeId: 6, measuredMm: 100 }] }), { status: 400 });
  assert.equal(f.stored.length, 0);
});

test('inspection saves independent readings for different punch sizes and faces at the same position', async () => {
  const f = fixture({ holes: [
    { id: 5, punchSize: '12x20', profile: 'l_lip', targetMm: 100 },
    { id: 6, punchSize: '10', profile: 'r_lip', targetMm: 100 },
  ] });
  f.run.status = 'running';
  f.run.sectionProfile = 'c_lip';
  const left = { holeId: 5, measuredMm: 99.9 };
  await assert.rejects(f.save({ approved: true, measurements: [left] }), { status: 400 });
  await f.save({ approved: true, measurements: [left, { holeId: 6, measuredMm: 100.1 }] });
  const snapshot = JSON.parse(f.stored[0].snapshot);
  assert.equal(snapshot.sectionProfile, 'c_lip');
  assert.deepEqual(snapshot.measurements.map(hole => [hole.profile, hole.punchSize, hole.measuredMm]), [
    ['l_lip', '12x20', 99.9], ['r_lip', '10', 100.1],
  ]);
});

test('first-piece approval cannot start a machine under maintenance',async()=>{
 const f=fixture({maintenance:true});await assert.rejects(f.save({approved:true,requestKey:'maintenance_hc_1234',measurements:[{holeId:5,measuredMm:100.1}],measuredCutLengthMm:2300.2,measuredSectionSize:'150.1 x 65 x 20'}),{status:409});assert.equal(f.stored.length,0);
});

test('paused production cannot resume while its machine is under maintenance',async()=>{const f=fixture({maintenance:true});f.run.status='paused';await assert.rejects(f.control('resume'),{status:409});assert.equal(f.run.status,'paused');assert.equal(f.calls.commits,0);});

test('rejected NOS and calculated weights save atomically and retries never add another rejected record',async()=>{
 const f=fixture(),body={approved:true,requestKey:'rejected_retry_123',measurements:[{holeId:5,measuredMm:100.1}],measuredCutLengthMm:2300,measuredSectionSize:'150x65x20',rejectedPieces:3};
 await f.save(body);await f.save(body);assert.equal(f.stored.length,1);
 const snapshot=JSON.parse(f.stored[0].snapshot);assert.equal(snapshot.rejectedPieces,3);assert.equal(snapshot.rejectedUsedKg,41.2737);assert(snapshot.rejectedWeightKg<snapshot.rejectedUsedKg);assert(snapshot.rejectedHoleScrapKg>0);
 await assert.rejects(f.save({...body,rejectedPieces:4}),{status:409});
 for(const rejectedPieces of [-1,1.5,'bad',100001])await assert.rejects(f.save({...body,requestKey:'invalid_qty_123',rejectedPieces}),{status:400});
 assert.equal(f.stored.length,1);
});

test('standalone rejection records weight without approving setup or fabricating measurements, and retries are safe',async()=>{
 const f=fixture(),body={approved:true,entryKind:'rejection',measurements:[],rejectedPieces:3,requestKey:'standalone_reject_123'};
 await f.save(body);await f.save(body);
 assert.equal(f.run.status,'setup');assert.equal(f.stored.length,1);
 const saved=JSON.parse(f.stored[0].snapshot);assert.equal(saved.entryKind,'rejection');assert.deepEqual(saved.measurements,[]);assert.equal(saved.measuredCutLengthMm,undefined);assert.equal(saved.rejectedUsedKg,41.2737);
 for(const rejectedPieces of [0,null,-1,1.5,100001])await assert.rejects(f.save({...body,rejectedPieces,requestKey:'invalid_rejection_123'}),{status:400});
 await assert.rejects(f.save({...body,measurements:[{holeId:5,measuredMm:100}]}),{status:400});
 assert.equal(f.stored.length,1);
});

test('rejected cut-length list saves all lines with actual-length use and safe retries',async()=>{
 const f=fixture(),body={approved:true,entryKind:'rejection',measurements:[],requestKey:'reject_lengths_123',rejectedLines:[{cutLengthMm:2100,pieces:2},{cutLengthMm:2400,pieces:2},{cutLengthMm:2200,pieces:1}]};
 await f.save(body);await f.save(body);
 assert.equal(f.stored.length,1);assert.equal(f.run.status,'setup');
 const saved=JSON.parse(f.stored[0].snapshot);
 assert.equal(saved.rejectedPieces,5);assert.equal(saved.rejectedUsedKg,66.995);
 assert.deepEqual(saved.rejectedLines.map(({cutLengthMm,pieces})=>({cutLengthMm,pieces})),body.rejectedLines);
 assert.equal(saved.measuredCutLengthMm,undefined);assert.deepEqual(saved.measurements,[]);
 await assert.rejects(f.save({...body,rejectedLines:[{cutLengthMm:2300,pieces:5}]}),{status:409});
 for(const rejectedLines of [[],null,[{cutLengthMm:0,pieces:1}],[{cutLengthMm:2400,pieces:0}],[{cutLengthMm:2400,pieces:1.5}],[{cutLengthMm:2400,pieces:100001}]])await assert.rejects(f.save({...body,requestKey:'reject_bad_length_123',rejectedLines}),{status:400});
 await assert.rejects(f.save({...body,requestKey:'reject_bad_total_123',rejectedPieces:4}),{status:400});
 assert.equal(f.stored.length,1);
});
