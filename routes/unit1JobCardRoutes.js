const router = require('express').Router();
const db = require('../config/unit1Db');
const access = require('../middleware/roleMiddleware');
const { PRODUCTS, positiveId } = require('../services/unit1ProductionValidation');
const { publishUnit1Change } = require('../services/unit1Realtime');

const columns = `j.id, j.job_date AS jobDate, j.customer_name AS customerName,
  j.project_name_capacity AS projectNameCapacity, j.production_qty AS productionQty,
  j.structure_type AS structureType, j.member_name AS memberName,
  j.section_size AS sectionSize, j.shift, j.cut_length_mm AS cutLengthMm,
  j.machine_id AS machineId, m.code AS machineCode, m.name AS machineName,
  j.planned_machine_id AS plannedMachineId, pm.code AS plannedMachineCode, pm.name AS plannedMachineName,
  j.material_type AS materialType, j.coil_width_mm AS coilWidthMm,
  j.coil_thickness_mm AS coilThicknessMm, j.punch_size AS punchSize,
  j.status, j.archived_at AS archivedAt, j.created_at AS createdAt, j.updated_at AS updatedAt,
  COALESCE(p.producedPieces,0) AS producedPieces, COALESCE(p.runCount,0) AS runCount`;
const joins = `FROM unit1_job_cards j LEFT JOIN unit1_machines m ON m.id=j.machine_id
  LEFT JOIN unit1_machines pm ON pm.id=j.planned_machine_id
  LEFT JOIN (SELECT job_card_id, SUM(produced_pieces) AS producedPieces, COUNT(*) AS runCount
    FROM unit1_production_runs WHERE job_card_id IS NOT NULL GROUP BY job_card_id) p ON p.job_card_id=j.id`;
const trim = (value, max) => String(value ?? '').trim().slice(0, max + 1);
const decimal = value => Number(value);
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function validate(body) {
  const stockCoilId = body?.stockCoilId == null || body.stockCoilId === '' ? null : positiveId(body.stockCoilId);
  const plannedMachineId = positiveId(body?.plannedMachineId);
  if (body?.stockCoilId != null && body.stockCoilId !== '' && !stockCoilId) return { error: 'Select a valid coil from stock.' };
  const value = {
    jobDate: String(body?.jobDate || ''), customerName: trim(body?.customerName, 150),
    projectNameCapacity: trim(body?.projectNameCapacity, 180), productionQty: positiveId(body?.productionQty),
    structureType: String(body?.structureType || ''), memberName: trim(body?.memberName, 120),
    sectionSize: trim(body?.sectionSize, 100), shift: String(body?.shift || '').toLowerCase(),
    cutLengthMm: decimal(body?.cutLengthMm),
    materialType: trim(body?.materialType, 20), coilWidthMm: decimal(body?.coilWidthMm),
    coilThicknessMm: decimal(body?.coilThicknessMm), punchSize: trim(body?.punchSize, 100),
  };
  if (!validDate(value.jobDate)) return { error: 'Enter a valid job date.' };
  if (![value.customerName, value.projectNameCapacity, value.memberName, value.sectionSize, value.materialType, value.punchSize].every(Boolean)) return { error: 'Complete all job card fields.' };
  if ([value.customerName, value.projectNameCapacity, value.memberName, value.sectionSize, value.materialType, value.punchSize].some((field, index) => field.length > [150, 180, 120, 100, 20, 100][index])) return { error: 'A job card field is too long.' };
  if (!value.productionQty || value.productionQty > 10000000) return { error: 'Enter a valid production quantity.' };
  if (!PRODUCTS.some(product => product.key === value.structureType)) return { error: 'Select a valid structure type.' };
  if (!['MS', 'GL', 'GP', 'Posmac'].includes(value.materialType)) return { error: 'Select a valid coil material.' };
  if (!['day', 'night'].includes(value.shift)) return { error: 'Select Day or Night shift.' };
  if (![value.cutLengthMm, value.coilWidthMm, value.coilThicknessMm].every(n => Number.isFinite(n) && n > 0 && n < 1000000)) return { error: 'Length, coil width and thickness must be positive numbers.' };
  if (!Array.isArray(body?.holes) || !body.holes.length || body.holes.length > 100) return { error: 'Add at least one hole position (maximum 100).' };
  const holes = body.holes.map((hole, index) => ({ sequenceNo: index + 1, profile: String(hole?.profile || ''), punchSize: trim(hole?.punchSize || value.punchSize, 100), targetMm: decimal(hole?.targetMm) }));
  if (holes.some((hole, index) => body.holes[index]?.targetMm === '' || body.holes[index]?.targetMm == null || !['l_flange', 'r_flange', 'web', 'lip'].includes(hole.profile) || !hole.punchSize || hole.punchSize.length > 100 || !Number.isFinite(hole.targetMm) || hole.targetMm < 0 || hole.targetMm > value.cutLengthMm)) return { error: 'Each hole needs a punch size, profile and position within cut length.' };
  return { value: { ...value, stockCoilId, plannedMachineId, holes } };
}

async function getJob(id) {
  const [[job], [holes]] = await Promise.all([
    db.execute(`SELECT ${columns} ${joins} WHERE j.id=?`, [id]),
    db.execute('SELECT id, sequence_no AS sequenceNo, profile, punch_size AS punchSize, target_mm AS targetMm FROM unit1_job_card_holes WHERE job_card_id=? ORDER BY sequence_no', [id]),
  ]);
  return job[0] ? { ...job[0], holes } : null;
}

router.get('/', access([], 'unit1.production.view'), async (req, res, next) => {
  try {
    const status = String(req.query.status || '');
    if (status && !['open', 'completed'].includes(status)) return res.status(400).json({ error: 'Invalid job card status filter.' });
    const search = String(req.query.q || '').trim().slice(0, 100);
    const assignable = req.query.assignable === '1';
    const conditions = ['j.archived_at IS NULL'];
    const params = [];
    if (req.user.role === 'labour') { conditions.push('j.machine_id=?'); params.push(req.user.assignedMachineId || 0); }
    if (status) { conditions.push('j.status=?'); params.push(status); }
    if (assignable) conditions.push("j.status='open' AND j.machine_id IS NULL");
    const machineId = positiveId(req.query.machineId);
    if (machineId) { conditions.push('(j.planned_machine_id=? OR j.planned_machine_id IS NULL)'); params.push(machineId); }
    if (search) {
      conditions.push('(CAST(j.id AS CHAR) LIKE ? OR j.customer_name LIKE ? OR j.project_name_capacity LIKE ? OR j.member_name LIKE ? OR j.section_size LIKE ?)');
      params.push(...Array(5).fill(`%${search}%`));
    }
    const [jobs] = await db.query(`SELECT ${columns} ${joins} WHERE ${conditions.join(' AND ')} ORDER BY j.id DESC LIMIT 200`, params);
    const ids = jobs.map(job => job.id);
    const [holes] = ids.length ? await db.query(`SELECT id, job_card_id AS jobCardId, sequence_no AS sequenceNo, profile, punch_size AS punchSize, target_mm AS targetMm FROM unit1_job_card_holes WHERE job_card_id IN (${ids.map(() => '?').join(',')}) ORDER BY sequence_no`, ids) : [[]];
    res.json({ data: jobs.map(job => ({ ...job, holes: holes.filter(hole => hole.jobCardId === job.id) })) });
  } catch (error) { next(error); }
});

router.get('/:id', access([], 'unit1.production.view'), async (req, res, next) => {
  const id = positiveId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid job card ID.' });
  if (req.user.role === 'labour') return res.status(403).json({ error: 'Job card details are unavailable to Labour users.' });
  try { const job = await getJob(id); return job ? res.json({ data: job }) : res.status(404).json({ error: 'Job card not found.' }); } catch (error) { next(error); }
});

async function save(req, res, next) {
  const id = req.params.id ? positiveId(req.params.id) : null;
  if (req.params.id && !id) return res.status(400).json({ error: 'Invalid job card ID.' });
  const parsed = validate(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const v = parsed.value;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    if (!id && !v.plannedMachineId) throw Object.assign(new Error('Select a planned machine for this job card.'), { status: 400 });
    if (v.plannedMachineId) {
      const [[plannedMachine]] = await connection.execute('SELECT id,is_active AS isActive FROM unit1_machines WHERE id=?', [v.plannedMachineId]);
      if (!plannedMachine?.isActive) throw Object.assign(new Error('Select an active planned machine.'), { status: 409 });
    }
    if (v.stockCoilId) {
      const [[coil]] = await connection.execute('SELECT id,status,coil_qty AS coilQty,material_type AS materialType,width_mm AS widthMm,thickness_mm AS thicknessMm FROM coils WHERE id=? FOR UPDATE', [v.stockCoilId]);
      const [[used]] = await connection.execute("SELECT COUNT(DISTINCT coil_number) AS usedQty FROM unit1_production_runs WHERE coil_id=? AND status <> 'returned'", [v.stockCoilId]);
      if (!coil || !['in_stock', 'allocated'].includes(coil.status) || Number(used.usedQty) >= Number(coil.coilQty)) throw Object.assign(new Error('Selected coil is no longer available in stock.'), { status: 409 });
      v.materialType = coil.materialType;
      v.coilWidthMm = Number(coil.widthMm);
      v.coilThicknessMm = Number(coil.thicknessMm);
    }
    if (id) {
      const [[job]] = await connection.execute('SELECT status,archived_at AS archivedAt,machine_id AS machineId,planned_machine_id AS plannedMachineId FROM unit1_job_cards WHERE id=? FOR UPDATE', [id]);
      if (!job) throw Object.assign(new Error('Job card not found.'), { status: 404 });
      if (job.archivedAt || !['open','completed'].includes(job.status)) throw Object.assign(new Error('Only active job cards can be edited.'), { status: 409 });
      if (job.machineId && v.plannedMachineId && Number(job.machineId) !== Number(v.plannedMachineId)) throw Object.assign(new Error('Unassign this job card before changing its planned machine.'), { status: 409 });
      const [[used]] = await connection.execute("SELECT COUNT(*) AS count, COALESCE(SUM(produced_pieces),0) AS pieces, SUM(status IN ('setup','running','paused')) AS activeCount FROM unit1_production_runs WHERE job_card_id=?", [id]);
      if (Number(used.count)) {
        if (v.productionQty < Number(used.pieces)) throw Object.assign(new Error('Production quantity cannot be less than pieces already produced.'), { status: 409 });
        await connection.execute('UPDATE unit1_job_cards SET job_date=?,customer_name=?,project_name_capacity=?,production_qty=?,status=? WHERE id=?', [v.jobDate,v.customerName,v.projectNameCapacity,v.productionQty,v.productionQty === Number(used.pieces) ? 'completed' : 'open',id]);
        await connection.commit();
        publishUnit1Change(req, 'job-cards', { jobCardId: id, action: 'job_updated' });
        return res.json({ data: await getJob(id) });
      }
      if (!v.plannedMachineId) throw Object.assign(new Error('Select a planned machine for this job card.'), { status: 400 });
      await connection.execute(`UPDATE unit1_job_cards SET job_date=?,customer_name=?,project_name_capacity=?,production_qty=?,structure_type=?,member_name=?,section_size=?,shift=?,cut_length_mm=?,planned_machine_id=?,material_type=?,coil_width_mm=?,coil_thickness_mm=?,punch_size=? WHERE id=?`, [v.jobDate,v.customerName,v.projectNameCapacity,v.productionQty,v.structureType,v.memberName,v.sectionSize,v.shift,v.cutLengthMm,v.plannedMachineId,v.materialType,v.coilWidthMm,v.coilThicknessMm,v.punchSize,id]);
      await connection.execute('DELETE FROM unit1_job_card_holes WHERE job_card_id=?', [id]);
    } else {
      const [insert] = await connection.execute(`INSERT INTO unit1_job_cards (job_date,customer_name,project_name_capacity,production_qty,structure_type,member_name,section_size,shift,cut_length_mm,machine_id,planned_machine_id,material_type,coil_width_mm,coil_thickness_mm,punch_size,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [v.jobDate,v.customerName,v.projectNameCapacity,v.productionQty,v.structureType,v.memberName,v.sectionSize,v.shift,v.cutLengthMm,null,v.plannedMachineId,v.materialType,v.coilWidthMm,v.coilThicknessMm,v.punchSize,req.user.id]);
      req.savedJobId = insert.insertId;
    }
    const jobId = id || req.savedJobId;
    for (const hole of v.holes) await connection.execute('INSERT INTO unit1_job_card_holes (job_card_id,sequence_no,profile,punch_size,target_mm) VALUES (?,?,?,?,?)', [jobId,hole.sequenceNo,hole.profile,hole.punchSize,hole.targetMm]);
    await connection.commit();
    publishUnit1Change(req, 'job-cards', { jobCardId: jobId, action: id ? 'job_updated' : 'job_created' });
    res.status(id ? 200 : 201).json({ data: await getJob(jobId) });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
}

router.post('/', access([], 'unit1.jobcards.manage'), save);
router.put('/:id', access([], 'unit1.jobcards.manage'), save);

router.delete('/:id', access([], 'unit1.jobcards.manage'), async (req, res, next) => {
  const jobId = positiveId(req.params.id);
  if (!jobId) return res.status(400).json({ error: 'Invalid job card ID.' });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[job]] = await connection.execute('SELECT id,status,archived_at AS archivedAt FROM unit1_job_cards WHERE id=? FOR UPDATE', [jobId]);
    if (!job) throw Object.assign(new Error('Job card not found.'), { status: 404 });
    if (job.archivedAt) throw Object.assign(new Error('This job card is already removed.'), { status: 409 });
    const [[history]] = await connection.execute("SELECT COUNT(*) AS count, SUM(status IN ('setup','running','paused')) AS activeCount FROM unit1_production_runs WHERE job_card_id=?", [jobId]);
    if (Number(history.activeCount)) throw Object.assign(new Error('Complete the active coil run before deleting this job card.'), { status: 409 });
    if (Number(history.count)) {
      await connection.execute('UPDATE unit1_job_cards SET archived_at=UTC_TIMESTAMP(3),machine_id=NULL WHERE id=?', [jobId]);
    } else {
      await connection.execute('DELETE FROM unit1_job_card_holes WHERE job_card_id=?', [jobId]);
      await connection.execute('DELETE FROM unit1_job_cards WHERE id=?', [jobId]);
    }
    await connection.commit();
    publishUnit1Change(req, 'job-cards', { jobCardId: jobId, action: 'job_deleted' });
    res.json({ data: { deleted: true, archived: Number(history.count) > 0, id: jobId } });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});

router.put('/:id/assign', access([], 'unit1.jobcards.assign'), async (req, res, next) => {
  const jobId = positiveId(req.params.id);
  const machineId = positiveId(req.body?.machineId);
  if (!jobId || !machineId) return res.status(400).json({ error: 'Select a job card and machine.' });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[machine]] = await connection.execute('SELECT id,name,is_active AS isActive FROM unit1_machines WHERE id=? FOR UPDATE', [machineId]);
    if (!machine?.isActive) throw Object.assign(new Error('Choose an active machine.'), { status: 409 });
    const [[job]] = await connection.execute('SELECT id,status,machine_id AS machineId,planned_machine_id AS plannedMachineId FROM unit1_job_cards WHERE id=? FOR UPDATE', [jobId]);
    if (!job || job.status !== 'open') throw Object.assign(new Error('Choose an open job card.'), { status: 409 });
    if (job.plannedMachineId && Number(job.plannedMachineId) !== machineId) {
      const [[plannedMachine]] = await connection.execute('SELECT name,code FROM unit1_machines WHERE id=?', [job.plannedMachineId]);
      throw Object.assign(new Error(`This job card is planned for ${plannedMachine?.name || `machine #${job.plannedMachineId}`} (${plannedMachine?.code || 'unknown code'}). Select that machine to assign it.`), { status: 409 });
    }
    const [activeRuns] = await connection.execute("SELECT id FROM unit1_production_runs WHERE machine_id=? AND status IN ('setup','running','paused') LIMIT 1", [machineId]);
    if (activeRuns.length) throw Object.assign(new Error('This machine already has an active coil.'), { status: 409 });
    const [assigned] = await connection.execute("SELECT id FROM unit1_job_cards WHERE machine_id=? AND status='open' AND id<>? LIMIT 1 FOR UPDATE", [machineId, jobId]);
    if (assigned.length) throw Object.assign(new Error('This machine already has an assigned job card.'), { status: 409 });
    await connection.execute('UPDATE unit1_job_cards SET machine_id=? WHERE id=?', [machineId, jobId]);
    await connection.commit();
    publishUnit1Change(req, 'job-cards', { jobCardId: jobId, action: 'job_assigned' });
    res.json({ data: await getJob(jobId) });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});

router.put('/:id/unassign', access([], 'unit1.jobcards.unassign'), async (req, res, next) => {
  const jobId = positiveId(req.params.id);
  if (!jobId) return res.status(400).json({ error: 'Invalid job card ID.' });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[job]] = await connection.execute('SELECT id,status,machine_id AS machineId FROM unit1_job_cards WHERE id=? FOR UPDATE', [jobId]);
    if (!job) throw Object.assign(new Error('Job card not found.'), { status: 404 });
    if (job.status !== 'open' || !job.machineId) throw Object.assign(new Error('Only an assigned open job card can be unassigned.'), { status: 409 });
    const [[active]] = await connection.execute("SELECT COUNT(*) AS count FROM unit1_production_runs WHERE job_card_id=? AND status IN ('setup','running','paused')", [jobId]);
    if (Number(active.count)) throw Object.assign(new Error('Remove the setup coil or complete the active coil run before unassigning this job card.'), { status: 409 });
    await connection.execute('UPDATE unit1_job_cards SET machine_id=NULL WHERE id=?', [jobId]);
    await connection.commit();
    publishUnit1Change(req, 'job-cards', { jobCardId: jobId, action: 'job_unassigned' });
    res.json({ data: await getJob(jobId) });
  } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});

module.exports = router;
