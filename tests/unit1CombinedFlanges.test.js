const test = require('node:test');
const assert = require('node:assert/strict');
const planning = require('../services/unit1Planning');
const { holeScrapKg } = require('../services/unit1MaterialWeight');
const { snapshotInspection } = require('../services/unit1HoleReports');
const { parsePunchRequirements } = require('../services/unit1PunchRequirements');

const specification = () => ({
  structureType: 'solar_mounting_structure', sectionProfile: 'c_lip', memberName: 'Test flange profile',
  sectionSize: '150x65x20', cutLengthMm: 1000, materialType: 'MS',
  allowedCoilSizes: [{ widthMm: 298, thicknessMm: 3 }], punchSize: '12x20',
  holes: [100, 500].map(targetMm => ({ profile: 'lr_flange', punchName: null, punchSize: '12x20', targetMm })),
});

test('both flange definitions reach independent inspection readings and double the matching single-side scrap', () => {
  const value = planning.material(specification());
  assert.equal(value.holes.length, 4);
  assert.ok(value.holes.every(hole => ['l_flange', 'r_flange'].includes(hole.profile)));
  const parsed = parsePunchRequirements([{ punchName: null, profile: 'lr_flange', punchSize: '12x20', dimensions: '100-500' }], 1000);
  assert.equal(parsed.length, 4);
  const args = { thicknessMm: 3, pieces: 100 };
  const both = holeScrapKg({ ...args, holes: value.holes });
  const left = holeScrapKg({ ...args, holes: value.holes.filter(hole => hole.profile === 'l_flange') });
  assert.ok(Math.abs(both - left * 2) < 1e-10);
  const holes = value.holes.map((hole, index) => ({ ...hole, id: index + 1 }));
  const readings = new Map(holes.map((hole, index) => [hole.id, hole.targetMm + index / 10]));
  const inspection = snapshotInspection({ ...value, id: 1 }, holes, readings, { name: 'day', shiftDate: '2026-11-19' }, 'Tester');
  assert.equal(inspection.measurements.length, 4);
  assert.deepEqual(inspection.measurements.map(reading => reading.measuredMm), holes.map(hole => readings.get(hole.id)));
  for (const sectionProfile of ['flat', 'angle', 'w_beam']) {
    assert.throws(() => planning.material({ ...specification(), sectionProfile }), /both left and right flanges/);
  }
});

test('Job Card PDF lists both physical flange requirements', async () => {
  const value = planning.material(specification());
  const bytes = await require('../services/pdf/unit1JobCardPdfGenerator').generateJobCardPdf({ ...value, id: 1, isTemplate: true });
  const parser = new (require('pdf-parse').PDFParse)({ data: bytes });
  try {
    const { text } = await parser.getText();
    assert.match(text, /L FLANGE/);
    assert.match(text, /R FLANGE/);
  } finally {
    await parser.destroy();
  }
});

test('local template and linked planning save and correct both flanges atomically', {
  skip: process.env.UNIT1_PLANNING_DB_TEST !== '1',
}, async () => {
  require('dotenv-flow').config({ silent: true });
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.UNIT1_DB_HOST || process.env.DB_HOST));
  const db = require('../config/unit1Db');
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const facade = { query: c.query.bind(c), execute: c.execute.bind(c), beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} };
    const scopedDb = { ...facade, getConnection: async () => facade };
    const [[actor]] = await c.execute('SELECT id FROM users LIMIT 1');
    const [[machine]] = await c.execute('SELECT id FROM unit1_machines WHERE is_active=1 LIMIT 1');
    const template = await planning.saveTemplate(scopedDb, null, { ...specification(), name: 'Combined flange test' }, actor.id);
    const plan = await planning.savePlan(scopedDb, null, {
      partyName: 'TEST', projectName: '', planDate: '2026-11-19', shift: 'day',
      requestKey: 'combined_flange_' + Date.now(), lines: [{ templateId: template.id, machineId: machine.id, quantity: 100 }],
    }, actor.id);
    const savedPlan = (await planning.plans(scopedDb)).find(row => Number(row.id) === Number(plan.id));
    assert.ok(savedPlan);
    const jobId = savedPlan.lines[0].id;
    const job = await planning.job(c, jobId);
    assert.equal(job.holes.length, 4);
    const changed = { ...specification(), id: template.id, version: 1, name: 'Combined flange test', holes: [100, 600].map(targetMm => ({ profile: 'lr_flange', punchName: null, punchSize: '12x20', targetMm })) };
    await planning.saveTemplate(scopedDb, template.id, changed, actor.id);
    const corrected = await planning.job(c, jobId);
    assert.equal(corrected.holes.length, 4);
    assert.equal(corrected.holes.filter(hole => hole.targetMm === 600).length, 2);
    const [old] = await c.execute('SELECT target_mm targetMm FROM unit1_job_card_holes WHERE job_card_id=? AND is_active=0', [jobId]);
    assert.equal(old.filter(hole => Number(hole.targetMm) === 500).length, 2);
  } finally {
    await c.rollback();
    c.release();
    await db.end();
  }
});
